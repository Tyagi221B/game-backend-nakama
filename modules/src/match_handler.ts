/// <reference path="../node_modules/nakama-runtime/index.d.ts" />

// match_handler.ts - Tic-Tac-Toe Game Logic
// This is the HEART of the assignment - ALL game logic lives here!
// This demonstrates SERVER-AUTHORITATIVE architecture

// Type definitions are in types.ts for better code organization

// ==================== MATCH LIFECYCLE FUNCTIONS ====================

// 1. matchInit - Called when match is CREATED (like constructor)
// Think: new TicTacToeGame()
let matchInit: nkruntime.MatchInitFunction<GameState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  params: { [key: string]: string }
) {
  // Get mode from params (sent by matchCreate)
  var mode: GameMode = (params.mode as GameMode) || "timed";
  logger.info("<� New Tic-Tac-Toe match created with mode: " + mode);

  // Create fresh game state (empty board, no players)
  var state: GameState = {
    board: [null, null, null, null, null, null, null, null, null], // Empty 3x3 board
    currentTurn: null,
    players: {},
    status: "waiting",
    winner: null,
    mode: mode,
    createdAt: Date.now(),
    turnStartTimestamp: null,
  };

  return {
    state: state,
    tickRate: 1, // Server tick rate (1 = process every second)
    label: JSON.stringify({ open: 1, mode: mode }),   // Mark match as open with mode for matchmaking
  };
};

// 2. matchJoinAttempt - Check if player CAN join (validation)
// Think: Express middleware checking authorization
let matchJoinAttempt: nkruntime.MatchJoinAttemptFunction<GameState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: GameState,
  presence: nkruntime.Presence,
  metadata: { [key: string]: any }
) {
  // VALIDATION: Only allow 2 players max
  var playerCount = Object.keys(state.players).length;

  if (playerCount >= 2) {
    logger.info("L Match full, rejecting player: " + presence.username);
    return {
      state: state,
      accept: false,
      rejectMessage: "Match is full (2 players max)",
    };
  }

  logger.info(" Accepting player: " + presence.username);
  return {
    state: state,
    accept: true,
  };
};

// 3. matchJoin - Player successfully JOINED (assign X or O)
// Think: Adding user to game session
let matchJoin: nkruntime.MatchJoinFunction<GameState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: GameState,
  presences: nkruntime.Presence[]
) {
  // Add each new player
  for (var i = 0; i < presences.length; i++) {
    var presence = presences[i];

    // Normalize username (trim whitespace)
    var normalizedUsername = presence.username ? presence.username.trim() : "Unknown";

    // Assign X or O based on join order
    var playerCount = Object.keys(state.players).length;
    var symbol: "X" | "O" = playerCount === 0 ? "X" : "O";

    state.players[presence.userId] = {
      username: normalizedUsername,
      symbol: symbol,
      connected: true,
    };

    logger.info(
      "Player " + normalizedUsername + " joined as " + symbol +
      ". Total players: " + (playerCount + 1)
    );
  }

  // Start game when both players are present
  if (Object.keys(state.players).length === 2) {
    state.status = "active";

    // X goes first - find the player with symbol "X"
    var playerIds = Object.keys(state.players);
    for (var j = 0; j < playerIds.length; j++) {
      if (state.players[playerIds[j]].symbol === "X") {
        state.currentTurn = playerIds[j];
        break;
      }
    }

    // Start the turn timer only for timed mode
    if (state.mode === "timed") {
      state.turnStartTimestamp = Date.now();
      logger.info("<� Game started! X goes first. Turn timer started (30s per turn).");
    } else {
      state.turnStartTimestamp = null;
      logger.info("<� Game started! X goes first. Classic mode (no timer).");
    }

    // Close the match - no longer accepting players
    dispatcher.matchLabelUpdate(JSON.stringify({ open: 0, mode: state.mode }));
  }

  // Broadcast updated state to all players
  broadcastState(dispatcher, state);

  return { state: state };
};

// 4. matchLoop - THE CORE GAME LOGIC! (most important function!)
// Runs every server tick, processes player moves
// Think: Express route handler processing POST /game/move
let matchLoop: nkruntime.MatchLoopFunction<GameState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: GameState,
  messages: nkruntime.MatchMessage[]
) {
  // Process all incoming messages from clients
  for (var i = 0; i < messages.length; i++) {
    var message = messages[i];

    try {
      // Parse message data
      var data = JSON.parse(nk.binaryToString(message.data));

      // Route based on operation code (like Express routing)
      switch (message.opCode) {
        case OpCode.MAKE_MOVE:
          logger.info(
            "=� Move received from " + message.sender.username +
            ": position " + data.position
          );
          // SERVER-AUTHORITATIVE: Validate and apply move
          state = handleMove(
            state,
            message.sender.userId,
            data.position,
            dispatcher,
            logger,
            nk
          );
          break;

        // WebRTC Voice Chat Signaling - Broadcast to all (client filters own messages)
        case OpCode.WEBRTC_OFFER:
          logger.info("[VOICE] WebRTC offer received from " + message.sender.username + ", broadcasting to all");
          // Broadcast to everyone - client will filter out own messages
          dispatcher.broadcastMessage(OpCode.WEBRTC_OFFER, message.data);
          break;

        case OpCode.WEBRTC_ANSWER:
          logger.info("[VOICE] WebRTC answer received from " + message.sender.username + ", broadcasting to all");
          dispatcher.broadcastMessage(OpCode.WEBRTC_ANSWER, message.data);
          break;

        case OpCode.WEBRTC_ICE_CANDIDATE:
          logger.info("[VOICE] ICE candidate received from " + message.sender.username + ", broadcasting to all");
          dispatcher.broadcastMessage(OpCode.WEBRTC_ICE_CANDIDATE, message.data);
          break;

        default:
          logger.warn("� Unknown opCode: " + message.opCode);
      }
    } catch (error) {
      logger.error("L Error processing message: " + error);
    }
  }

  // Check for turn timeout (30 seconds) - only for timed mode
  if (state.mode === "timed" && state.status === "active" && state.turnStartTimestamp !== null && state.currentTurn !== null) {
    var currentTime = Date.now();
    var timeElapsed = currentTime - state.turnStartTimestamp;
    var TIMEOUT_MS = 30000; // 30 seconds

    if (timeElapsed >= TIMEOUT_MS) {
      logger.info("[TIMEOUT] Player " + state.currentTurn + " exceeded 30 seconds. Opponent wins!");

      // Find the opponent (the player who is NOT currentTurn)
      var playerIds = Object.keys(state.players);
      for (var k = 0; k < playerIds.length; k++) {
        if (playerIds[k] !== state.currentTurn) {
          // Opponent wins by timeout
          state.winner = playerIds[k];
          state.status = "completed";
          logger.info("<� Player " + playerIds[k] + " (" + state.players[playerIds[k]].username + ") wins by timeout!");

          // Update leaderboard
          updateLeaderboard(nk, state, logger);

          // Broadcast final state
          broadcastState(dispatcher, state);
          break;
        }
      }
    }
  }

  return { state: state };
};

// 5. matchLeave - Player DISCONNECTED (handle gracefully)
let matchLeave: nkruntime.MatchLeaveFunction<GameState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: GameState,
  presences: nkruntime.Presence[]
) {
  for (var i = 0; i < presences.length; i++) {
    var presence = presences[i];
    logger.info("=K Player " + presence.username + " left the match");

    // EDGE CASE FIX: If game is still waiting for players, completely remove them
    // This prevents ghost players from blocking new players who join later
    if (state.status === "waiting") {
      if (state.players[presence.userId]) {
        delete state.players[presence.userId];
        logger.info("? Player removed from waiting match (cancelled matchmaking)");
      }
    } else {
      // Game is active - mark as disconnected (keep for leaderboard)
      if (state.players[presence.userId]) {
        state.players[presence.userId].connected = false;
      }

      // If game is active and someone left, other player wins by forfeit
      if (state.status === "active") {
        var playerIds = Object.keys(state.players);
        for (var j = 0; j < playerIds.length; j++) {
          var playerId = playerIds[j];
          if (playerId !== presence.userId && state.players[playerId].connected) {
            state.status = "completed";
            state.winner = playerId;
            logger.info("<� Player " + playerId + " wins by forfeit");

            // Update leaderboard
            updateLeaderboard(nk, state, logger);
            break;
          }
        }
      }
    }
  }

  // Broadcast updated state
  broadcastState(dispatcher, state);

  return { state: state };
};

// 6. matchTerminate - Match is ENDING (cleanup)
let matchTerminate: nkruntime.MatchTerminateFunction<GameState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: GameState,
  graceSeconds: number
) {
  logger.info("Match terminated");
  return { state: state };
};

// 7. matchSignal - Handle external signals (not used for tic-tac-toe, but required by Nakama)
let matchSignal: nkruntime.MatchSignalFunction<GameState> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: GameState,
  data: string
) {
  logger.info("Match signal received");
  return { state: state };
};

// ==================== HELPER FUNCTIONS ====================

// Handle player move - THE SERVER-AUTHORITATIVE VALIDATION!
// This is WHERE we prevent cheating!
function handleMove(
  state: GameState,
  userId: string,
  position: number,
  dispatcher: nkruntime.MatchDispatcher,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama
): GameState {
  // L VALIDATION 1: Game must be active
  if (state.status !== "active") {
    logger.warn("L Move rejected: game not active");
    return state;
  }

  // L VALIDATION 2: Must be player's turn
  if (state.currentTurn !== userId) {
    logger.warn("L Move rejected: not " + userId + "'s turn");
    return state;
  }

  // L VALIDATION 3: Position must be valid (0-8)
  if (position < 0 || position > 8) {
    logger.warn("L Move rejected: invalid position " + position);
    return state;
  }

  // L VALIDATION 4: Cell must be empty
  if (state.board[position] !== null) {
    logger.warn("L Move rejected: cell " + position + " already occupied");
    return state;
  }

  //  ALL VALIDATIONS PASSED - Apply the move
  var symbol = state.players[userId].symbol;
  state.board[position] = symbol;
  logger.info(" Move applied: " + symbol + " at position " + position);

  // Check for winner or draw
  var winner = checkWinner(state.board);

  if (winner) {
    state.status = "completed";

    if (winner === "draw") {
      state.winner = "draw";
      logger.info("> Game ended in a draw");
    } else {
      // Find user ID with winning symbol
      var playerIds = Object.keys(state.players);
      for (var i = 0; i < playerIds.length; i++) {
        if (state.players[playerIds[i]].symbol === winner) {
          state.winner = playerIds[i];
          logger.info("<� Game won by " + winner + " (" + playerIds[i] + ")");
          break;
        }
      }
    }

    // Update leaderboard
    updateLeaderboard(nk, state, logger);
  } else {
    // Switch turn to other player
    var players = Object.keys(state.players);
    for (var j = 0; j < players.length; j++) {
      if (players[j] !== userId) {
        state.currentTurn = players[j];

        // Reset timer only for timed mode
        if (state.mode === "timed") {
          state.turnStartTimestamp = Date.now();
          logger.info("= Turn switched to " + state.currentTurn + ". Turn timer reset.");
        } else {
          logger.info("= Turn switched to " + state.currentTurn + ".");
        }
        break;
      }
    }
  }

  // Broadcast updated state to all players
  broadcastState(dispatcher, state);

  return state;
}

// Check if there's a winner
function checkWinner(board: (string | null)[]): string | null {
  // All possible winning combinations
  var winningLines = [
    [0, 1, 2], // Top row
    [3, 4, 5], // Middle row
    [6, 7, 8], // Bottom row
    [0, 3, 6], // Left column
    [1, 4, 7], // Middle column
    [2, 5, 8], // Right column
    [0, 4, 8], // Diagonal \
    [2, 4, 6], // Diagonal /
  ];

  // Check each winning line
  for (var i = 0; i < winningLines.length; i++) {
    var line = winningLines[i];
    var a = line[0];
    var b = line[1];
    var c = line[2];

    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a]; // Return "X" or "O"
    }
  }

  // Check for draw (all cells filled, no winner)
  var allFilled = true;
  for (var j = 0; j < board.length; j++) {
    if (board[j] === null) {
      allFilled = false;
      break;
    }
  }

  if (allFilled) {
    return "draw";
  }

  // Game still in progress
  return null;
}

// Broadcast state to all connected players
function broadcastState(dispatcher: nkruntime.MatchDispatcher, state: GameState): void {
  var stateJson = JSON.stringify(state);
  dispatcher.broadcastMessage(OpCode.STATE_UPDATE, stateJson);
}

// Update win streaks for a player
// result: "win" | "loss" | "draw"
function updateWinStreaks(
  nk: nkruntime.Nakama,
  userId: string,
  result: "win" | "loss" | "draw",
  logger: nkruntime.Logger
): void {
  try {
    const storageKey = userId + "_streaks";
    const collection = "user_streaks";

    // Try to read existing streak data
    var readObjects: nkruntime.StorageReadRequest[] = [{
      collection: collection,
      key: storageKey,
      userId: userId
    }];

    var existingObjects: nkruntime.StorageObject[] = [];
    try {
      existingObjects = nk.storageRead(readObjects);
    } catch (err) {
      logger.info("[STREAK] No existing streak data found for user " + userId + ", initializing");
    }

    // Get current streak values (default to 0 if not found)
    var currentWinStreak = 0;
    var bestWinStreak = 0;

    if (existingObjects && existingObjects.length > 0) {
      // StorageObject.value might be an object or string depending on Nakama version
      var value = existingObjects[0].value;
      var existingData: { currentWinStreak?: number; bestWinStreak?: number };

      if (typeof value === "string") {
        existingData = JSON.parse(value);
      } else {
        // Already an object
        existingData = value as { currentWinStreak?: number; bestWinStreak?: number };
      }

      currentWinStreak = existingData.currentWinStreak || 0;
      bestWinStreak = existingData.bestWinStreak || 0;
    }

    // Update streaks based on result
    if (result === "win") {
      currentWinStreak = currentWinStreak + 1;
      if (currentWinStreak > bestWinStreak) {
        bestWinStreak = currentWinStreak;
        logger.info(`[STREAK] New best win streak for ${userId}: ${bestWinStreak}`);
      }
      logger.info(`[STREAK] Win streak updated for ${userId}: ${currentWinStreak} (Best: ${bestWinStreak})`);
    } else {
      // Loss or draw - reset current streak
      if (currentWinStreak > 0) {
        logger.info(`[STREAK] Streak ended for ${userId} at ${currentWinStreak} (Best: ${bestWinStreak})`);
      }
      currentWinStreak = 0;
    }

    // Write updated streak data back to storage
    var streakData = {
      currentWinStreak: currentWinStreak,
      bestWinStreak: bestWinStreak
    };

    var writeObjects: nkruntime.StorageWriteRequest[] = [{
      collection: collection,
      key: storageKey,
      userId: userId,
      value: streakData as any, // Nakama storage accepts object or string
      permissionRead: 1, // Public read
      permissionWrite: 0  // Only server can write
    }];

    nk.storageWrite(writeObjects);
    logger.info(`[STREAK] Streak data saved for ${userId}`);
  } catch (err) {
    logger.error("[STREAK] Error updating win streaks: " + String(err));
    // Don't throw - streaks are nice-to-have, don't break the game
  }
}

// Update leaderboard with game results
function updateLeaderboard(
  nk: nkruntime.Nakama,
  state: GameState,
  logger: nkruntime.Logger
): void {
  try {
    logger.info("[LB] updateLeaderboard called; winner = " + String(state.winner));
    if (!state.winner) {
      logger.info("[LB] No winner to update leaderboard for.");
      return;
    }

    // Get all player IDs
    var playerIds = Object.keys(state.players);
    if (playerIds.length !== 2) {
      logger.warn("[LB] Expected 2 players, found " + playerIds.length);
      return;
    }

    // If it's a draw, reset streaks for both players (no wins/losses recorded)
    if (state.winner === "draw") {
      logger.info("[LB] Game ended in a draw. Resetting streaks for both players.");
      for (var d = 0; d < playerIds.length; d++) {
        updateWinStreaks(nk, playerIds[d], "draw", logger);
      }
      return;
    }

    // Record win for winner
    const winnerPlayer = state.players[state.winner];
    if (winnerPlayer) {
      const winnerUsername = winnerPlayer.username || "Unknown";
      logger.info(`[LB] Recording WIN: user=${state.winner} username=${winnerUsername}`);

      try {
        nk.leaderboardRecordWrite("global_wins", state.winner, winnerUsername, 1, 0);
        logger.info("[LB] Win recorded successfully");
      } catch (err) {
        logger.error("[LB] Failed to record win: " + String(err));
      }

      // Update win streak for winner
      updateWinStreaks(nk, state.winner, "win", logger);
    }

    // Record loss for loser
    for (var i = 0; i < playerIds.length; i++) {
      var playerId = playerIds[i];
      if (playerId !== state.winner) {
        const loserPlayer = state.players[playerId];
        if (loserPlayer) {
          const loserUsername = loserPlayer.username || "Unknown";
          logger.info(`[LB] Recording LOSS: user=${playerId} username=${loserUsername}`);

          try {
            nk.leaderboardRecordWrite("global_losses", playerId, loserUsername, 1, 0);
            logger.info("[LB] Loss recorded successfully");
          } catch (err) {
            logger.error("[LB] Failed to record loss: " + String(err));
          }

          // Reset win streak for loser
          updateWinStreaks(nk, playerId, "loss", logger);
        }
        break;
      }
    }

    logger.info("[LB] Leaderboard update completed");
  } catch (err) {
    logger.error("[LB] Unexpected error in updateLeaderboard: " + String(err));
  }
}