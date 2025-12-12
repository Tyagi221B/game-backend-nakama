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
  logger.info("<� New Tic-Tac-Toe match created!");

  // Create fresh game state (empty board, no players)
  var state: GameState = {
    board: [null, null, null, null, null, null, null, null, null], // Empty 3x3 board
    currentTurn: null,
    players: {},
    status: "waiting",
    winner: null,
    createdAt: Date.now(),
  };

  return {
    state: state,
    tickRate: 1, // Server tick rate (1 = process every second)
    label: JSON.stringify({ open: 1 }),   // Mark match as open for matchmaking
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

    // Assign X or O based on join order
    var playerCount = Object.keys(state.players).length;
    var symbol: "X" | "O" = playerCount === 0 ? "X" : "O";

    state.players[presence.userId] = {
      username: presence.username,
      symbol: symbol,
      connected: true,
    };

    logger.info(
      "Player " + presence.username + " joined as " + symbol +
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

    // Close the match - no longer accepting players
    dispatcher.matchLabelUpdate(JSON.stringify({ open: 0 }));

    logger.info("<� Game started! X goes first");
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

        default:
          logger.warn("� Unknown opCode: " + message.opCode);
      }
    } catch (error) {
      logger.error("L Error processing message: " + error);
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
        logger.info("= Turn switched to " + state.currentTurn);
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

// Update leaderboard with game results
function updateLeaderboard(
  nk: nkruntime.Nakama,
  state: GameState,
  logger: nkruntime.Logger
): void {
  try {
    logger.info("[LB] updateLeaderboard called; winner = " + String(state.winner));
    if (!state.winner || state.winner === "draw") {
      logger.info("[LB] No winner to update leaderboard for (draw or none).");
      return;
    }

    // defensive: ensure player exists
    const player = state.players && state.players[state.winner];
    if (!player) {
      logger.error("[LB] Winner id not found in state.players. winner=" + state.winner + " players=" + JSON.stringify(Object.keys(state.players || {})));
      return;
    }

    const winnerUsername = player.username || "Unknown";
    const leaderboardId = "global_wins";

    logger.info(`[LB] Writing leaderboard record: lb=${leaderboardId} owner=${state.winner} username=${winnerUsername} increment=1`);

    try {
      // Adjust parameters if your nakama-runtime version uses different order; catch errors.
      nk.leaderboardRecordWrite(leaderboardId, state.winner, winnerUsername, 1, 0);
      logger.info("[LB] Leaderboard write completed (no exception thrown).");
    } catch (err) {
      logger.error("[LB] leaderboardRecordWrite threw: " + String(err));
    }
  } catch (err) {
    logger.error("[LB] Unexpected error in updateLeaderboard: " + String(err));
  }
}