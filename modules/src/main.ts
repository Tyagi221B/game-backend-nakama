/// <reference path="../node_modules/nakama-runtime/index.d.ts" />
/// <reference path="types.ts" />
/// <reference path="match_handler.ts" />

// main.ts - Entry point for Nakama server modules
// This file is called by Nakama on startup

// InitModule is the REQUIRED entry point function
// Nakama calls this when the server starts
let InitModule: nkruntime.InitModule = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
) {
  logger.info("Initializing Tic-Tac-Toe server module...");

  // Register the Tic-Tac-Toe match handler
  // This tells Nakama: "When someone creates a 'tic_tac_toe' match, use these functions"
  initializer.registerMatch("tic_tac_toe", {
    matchInit,           // Called when match is created
    matchJoinAttempt,    // Called when player tries to join
    matchJoin,           // Called when player successfully joins
    matchLoop,           // Called every tick (processes game moves)
    matchLeave,          // Called when player leaves
    matchTerminate,      // Called when match ends
    matchSignal,         // Called when match receives external signal
  });

  logger.info("Match handler 'tic_tac_toe' registered");

  // Register RPC function for finding or creating matches
  initializer.registerRpc("find_match", rpcFindMatch);
  logger.info("RPC 'find_match' registered");

  // Register RPC function for fetching leaderboard
  initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);
  logger.info("RPC 'get_leaderboard' registered");

  // Register RPC function for deleting user data on logout
  initializer.registerRpc("delete_user_data", rpcDeleteUserData);
  logger.info("RPC 'delete_user_data' registered");

  // Create leaderboards for tracking player stats
  try {
    // Create wins leaderboard with increment operator
    nk.leaderboardCreate(
      "global_wins",      // Leaderboard ID
      false,              // Not authoritative
      nkruntime.SortOrder.DESCENDING,   // Sort order (highest score first)
      nkruntime.Operator.INCREMENTAL,   // Operator: increment scores (not replace)
      "",                 // No reset schedule
      {}                  // No metadata
    );
    logger.info("Leaderboard 'global_wins' created with increment operator");
  } catch (error) {
    // Leaderboard might already exist from previous runs - that's OK!
    logger.info("Leaderboard 'global_wins' already exists (this is normal on restart)");
  }

  try {
    // Create losses leaderboard with increment operator
    nk.leaderboardCreate(
      "global_losses",    // Leaderboard ID
      false,              // Not authoritative
      nkruntime.SortOrder.DESCENDING,   // Sort order (highest score first)
      nkruntime.Operator.INCREMENTAL,   // Operator: increment scores (not replace)
      "",                 // No reset schedule
      {}                  // No metadata
    );
    logger.info("Leaderboard 'global_losses' created with increment operator");
  } catch (error) {
    logger.info("Leaderboard 'global_losses' already exists (this is normal on restart)");
  }

  logger.info("Tic-Tac-Toe server module loaded successfully!");
};

// RPC function to find an existing match or create a new one
// This solves the matchmaking problem: first player creates, second player joins
let rpcFindMatch: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  logger.info("RPC find_match called by user: " + ctx.userId);

  // Parse mode from payload
  var data = JSON.parse(payload);
  var mode: string = data.mode || "timed"; // Default to timed for backwards compatibility
  logger.info("Finding match with mode: " + mode);

  // Validate mode
  if (mode !== "classic" && mode !== "timed") {
    logger.error("Invalid mode: " + mode);
    throw new Error("Invalid mode. Must be 'classic' or 'timed'");
  }

  // List all active tic-tac-toe matches with matching mode
  let matches: nkruntime.Match[];
  try {
    const query = "+label.open:1 +label.mode:" + mode; // Find open matches with same mode
    matches = nk.matchList(10, true, "", null, 1, query);
    logger.info("Found " + matches.length + " open matches for mode: " + mode);
  } catch (error) {
    logger.error("Error listing matches: " + error);
    throw error;
  }

  let matchId: string;

  if (matches.length > 0) {
    // There's an open match - join it!
    matchId = matches[0].matchId;
    logger.info("Joining existing match: " + matchId);
  } else {
    // No open matches - create a new one
    logger.info("No open matches found, creating new match with mode: " + mode);
    try {
      matchId = nk.matchCreate("tic_tac_toe", { open: true, mode: mode });
      logger.info("Created new match: " + matchId + " with mode: " + mode);
    } catch (error) {
      logger.error("Error creating match: " + error);
      throw error;
    }
  }

  // Return the match ID to the client
  return JSON.stringify({ matchId: matchId });
};

// Helper function to get streak data for a user
function getStreakData(
  nk: nkruntime.Nakama,
  userId: string,
  logger: nkruntime.Logger
): { winStreak: number; bestWinStreak: number } {
  try {
    const storageKey = userId + "_streaks";
    const collection = "user_streaks";

    var readObjects: nkruntime.StorageReadRequest[] = [{
      collection: collection,
      key: storageKey,
      userId: userId
    }];

    var existingObjects: nkruntime.StorageObject[] = [];
    try {
      existingObjects = nk.storageRead(readObjects);
    } catch (err) {
      // No streak data found - return defaults
      return { winStreak: 0, bestWinStreak: 0 };
    }

    if (existingObjects && existingObjects.length > 0) {
      // StorageObject.value might be an object or string depending on Nakama version
      var value = existingObjects[0].value;
      var streakData: { currentWinStreak?: number; bestWinStreak?: number };

      if (typeof value === "string") {
        streakData = JSON.parse(value);
      } else {
        // Already an object
        streakData = value as { currentWinStreak?: number; bestWinStreak?: number };
      }

      return {
        winStreak: streakData.currentWinStreak || 0,
        bestWinStreak: streakData.bestWinStreak || 0
      };
    }

    return { winStreak: 0, bestWinStreak: 0 };
  } catch (err) {
    logger.warn("[STREAK] Error reading streak data for " + userId + ": " + String(err));
    return { winStreak: 0, bestWinStreak: 0 };
  }
}

// RPC function to fetch the top players from the leaderboard
let rpcGetLeaderboard: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  logger.info("RPC get_leaderboard called");

  try {
    // Fetch wins
    var winsRecords = nk.leaderboardRecordsList("global_wins", [], 100, "", 0);

    // Fetch losses
    var lossesRecords = nk.leaderboardRecordsList("global_losses", [], 100, "", 0);

    // Create a map to combine wins and losses
    var playerStats: { [key: string]: any } = {};

    // Process wins
    if (winsRecords && winsRecords.records) {
      for (var i = 0; i < winsRecords.records.length; i++) {
        var record = winsRecords.records[i];
        playerStats[record.ownerId] = {
          userId: record.ownerId,
          username: record.username || "Unknown",
          wins: record.score,
          losses: 0
        };
      }
    }

    // Process losses
    if (lossesRecords && lossesRecords.records) {
      for (var j = 0; j < lossesRecords.records.length; j++) {
        var lossRecord = lossesRecords.records[j];
        if (playerStats[lossRecord.ownerId]) {
          playerStats[lossRecord.ownerId].losses = lossRecord.score;
        } else {
          playerStats[lossRecord.ownerId] = {
            userId: lossRecord.ownerId,
            username: lossRecord.username || "Unknown",
            wins: 0,
            losses: lossRecord.score
          };
        }
      }
    }

    // Convert to array and calculate win rate + fetch streaks
    var leaderboard = [];
    for (var userId in playerStats) {
      var player = playerStats[userId];
      var totalGames = player.wins + player.losses;
      var winRate = totalGames > 0 ? (player.wins / totalGames) * 100 : 0;

      // Fetch streak data for this player
      var streakData = getStreakData(nk, player.userId, logger);
      logger.info(`[LB] Player ${player.username} (${player.userId}): winStreak=${streakData.winStreak}, bestWinStreak=${streakData.bestWinStreak}`);

      leaderboard.push({
        userId: player.userId,
        username: player.username,
        wins: player.wins,
        losses: player.losses,
        winRate: Math.round(winRate * 10) / 10, // Round to 1 decimal
        winStreak: streakData.winStreak,
        bestWinStreak: streakData.bestWinStreak
      });
    }

    // Sort by wins (descending)
    leaderboard.sort(function (a, b) {
      return b.wins - a.wins;
    });

    // Take top 10
    leaderboard = leaderboard.slice(0, 10);

    logger.info("Returning " + leaderboard.length + " leaderboard entries with wins/losses/streaks");
    return JSON.stringify({ leaderboard: leaderboard });
  } catch (error) {
    logger.error("Error fetching leaderboard: " + error);
    return JSON.stringify({ leaderboard: [], error: String(error) });
  }
};

// RPC function to delete user data (for logout)
let rpcDeleteUserData: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  logger.info("[DELETE] ========================================");
  logger.info("[DELETE] RPC delete_user_data called by user: " + ctx.userId);

  try {
    if (!ctx.userId) {
      logger.error("[DELETE] No user ID in context");
      return JSON.stringify({ success: false, error: "No user ID" });
    }

    var userId = ctx.userId;

    // Delete wins leaderboard records
    logger.info("[DELETE] Attempting to delete wins leaderboard records...");
    try {
      nk.leaderboardRecordDelete("global_wins", userId);
      logger.info("[DELETE] ✓ Successfully deleted wins records for user: " + userId);
    } catch (error) {
      logger.warn("[DELETE] ✗ Failed to delete wins records (might not exist): " + error);
    }

    // Delete losses leaderboard records
    logger.info("[DELETE] Attempting to delete losses leaderboard records...");
    try {
      nk.leaderboardRecordDelete("global_losses", userId);
      logger.info("[DELETE] ✓ Successfully deleted losses records for user: " + userId);
    } catch (error) {
      logger.warn("[DELETE] ✗ Failed to delete losses records (might not exist): " + error);
    }

    // Delete streak storage object
    logger.info("[DELETE] Attempting to delete streak storage object...");
    try {
      const storageKey = userId + "_streaks";
      const collection = "user_streaks";
      var deleteObjects: nkruntime.StorageDeleteRequest[] = [{
        collection: collection,
        key: storageKey,
        userId: userId
      }];
      nk.storageDelete(deleteObjects);
      logger.info("[DELETE] ✓ Successfully deleted streak storage for user: " + userId);
    } catch (error) {
      logger.warn("[DELETE] ✗ Failed to delete streak storage (might not exist): " + error);
    }

    // All data deleted successfully - return success BEFORE deleting account
    // (Account deletion will close the WebSocket, so we return first)
    logger.info("[DELETE] ✓ Successfully completed deletion process for user: " + userId);
    logger.info("[DELETE] ========================================");

    // Delete user account asynchronously (after returning response)
    // This properly deletes the user and frees up the username for reuse
    // We do this last because it will invalidate the session and close the WebSocket
    logger.info("[DELETE] Attempting to delete user account using nk.accountDeleteId...");
    try {
      nk.accountDeleteId(userId);
      logger.info("[DELETE] ✓ Successfully deleted user account. Username is now available for reuse.");
    } catch (error) {
      logger.error("[DELETE] ✗ Failed to delete user account: " + error);
      // Don't return error here - data is already deleted, account deletion failure is logged
    }

    // Return success immediately (before account deletion closes the socket)
    return JSON.stringify({ success: true });
  } catch (error) {
    logger.error("[DELETE] ✗ Error deleting user data: " + error);
    logger.info("[DELETE] ========================================");
    return JSON.stringify({ success: false, error: String(error) });
  }
};
