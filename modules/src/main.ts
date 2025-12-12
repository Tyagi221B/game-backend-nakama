/// <reference path="../node_modules/nakama-runtime/index.d.ts" />

// main.ts - Entry point for Nakama server modules
// This file is called by Nakama on startup

// InitModule is the REQUIRED entry point function
// Nakama calls this when the server starts
let InitModule: nkruntime.InitModule = function(
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
    logger.info("Leaderboard already exists (this is normal on restart)");
  }

  logger.info("Tic-Tac-Toe server module loaded successfully!");
};

// RPC function to find an existing match or create a new one
// This solves the matchmaking problem: first player creates, second player joins
let rpcFindMatch: nkruntime.RpcFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  logger.info("RPC find_match called by user: " + ctx.userId);

  // List all active tic-tac-toe matches
  let matches: nkruntime.Match[];
  try {
    const query = "+label.open:1"; // Only find matches that are open (waiting for players)
    matches = nk.matchList(10, true, "", null, 1, query);
    logger.info("Found " + matches.length + " open matches");
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
    logger.info("No open matches found, creating new match");
    try {
      matchId = nk.matchCreate("tic_tac_toe", { open: true });
      logger.info("Created new match: " + matchId);
    } catch (error) {
      logger.error("Error creating match: " + error);
      throw error;
    }
  }

  // Return the match ID to the client
  return JSON.stringify({ matchId: matchId });
};

// RPC function to fetch the top players from the leaderboard
let rpcGetLeaderboard: nkruntime.RpcFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  logger.info("RPC get_leaderboard called");

  try {
    // Fetch top 10 players from the leaderboard
    var leaderboardId = "global_wins";
    var records = nk.leaderboardRecordsList(leaderboardId, [], 10, "", 0);

    // Check if records exist
    if (!records || !records.records) {
      logger.info("No leaderboard records found");
      return JSON.stringify({ leaderboard: [] });
    }

    // Format the response
    var leaderboard = [];
    for (var i = 0; i < records.records.length; i++) {
      var record = records.records[i];
      leaderboard.push({
        rank: record.rank,
        username: record.username || "Unknown",
        score: record.score,
        userId: record.ownerId
      });
    }

    logger.info("Returning " + leaderboard.length + " leaderboard entries");
    return JSON.stringify({ leaderboard: leaderboard });
  } catch (error) {
    logger.error("Error fetching leaderboard: " + error);
    return JSON.stringify({ leaderboard: [], error: String(error) });
  }
};

// RPC function to delete user data (for logout)
let rpcDeleteUserData: nkruntime.RpcFunction = function(
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

    // First, check if user has any leaderboard records
    var leaderboardId = "global_wins";
    logger.info("[DELETE] Checking leaderboard records for user: " + userId);

    try {
      var existingRecords = nk.leaderboardRecordsList(leaderboardId, [userId], 1, "", 0);
      if (existingRecords && existingRecords.records && existingRecords.records.length > 0) {
        logger.info("[DELETE] Found " + existingRecords.records.length + " leaderboard record(s) for user: " + userId);
        logger.info("[DELETE] Username in leaderboard: " + existingRecords.records[0].username);
        logger.info("[DELETE] Score: " + existingRecords.records[0].score);
      } else {
        logger.info("[DELETE] No leaderboard records found for user: " + userId);
      }
    } catch (error) {
      logger.warn("[DELETE] Error checking existing records: " + error);
    }

    // Delete leaderboard records
    logger.info("[DELETE] Attempting to delete leaderboard records...");
    try {
      nk.leaderboardRecordDelete(leaderboardId, userId);
      logger.info("[DELETE] ✓ Successfully deleted leaderboard records for user: " + userId);
    } catch (error) {
      logger.warn("[DELETE] ✗ Failed to delete leaderboard records (might not exist): " + error);
    }

    // Verify leaderboard deletion
    logger.info("[DELETE] Verifying leaderboard deletion...");
    try {
      var verifyRecords = nk.leaderboardRecordsList(leaderboardId, [userId], 1, "", 0);
      if (verifyRecords && verifyRecords.records && verifyRecords.records.length > 0) {
        logger.error("[DELETE] ✗ VERIFICATION FAILED: Records still exist after deletion!");
      } else {
        logger.info("[DELETE] ✓ VERIFICATION SUCCESS: No leaderboard records found after deletion");
      }
    } catch (error) {
      logger.warn("[DELETE] Could not verify leaderboard deletion: " + error);
    }

    // Delete user account from database using SQL
    logger.info("[DELETE] Attempting to delete user account from database...");
    try {
      // Delete from user_device table first (foreign key)
      var deleteDeviceQuery = "DELETE FROM user_device WHERE user_id = $1";
      nk.sqlExec(deleteDeviceQuery, [userId]);
      logger.info("[DELETE] ✓ Deleted user_device records for user: " + userId);

      // Delete from users table
      var deleteUserQuery = "DELETE FROM users WHERE id = $1";
      var result = nk.sqlExec(deleteUserQuery, [userId]);
      logger.info("[DELETE] ✓ Deleted user account from database. Rows affected: " + result.rowsAffected);
    } catch (error) {
      logger.error("[DELETE] ✗ Failed to delete user account from database: " + error);
      return JSON.stringify({ success: false, error: "Failed to delete user account from database" });
    }

    // Verify user deletion
    logger.info("[DELETE] Verifying user account deletion...");
    try {
      var verifyUserQuery = "SELECT id FROM users WHERE id = $1";
      var verifyResult = nk.sqlQuery(verifyUserQuery, [userId]);
      if (verifyResult && verifyResult.length > 0) {
        logger.error("[DELETE] ✗ VERIFICATION FAILED: User still exists in database after deletion!");
        return JSON.stringify({ success: false, error: "User deletion verification failed" });
      } else {
        logger.info("[DELETE] ✓ VERIFICATION SUCCESS: User account deleted from database");
      }
    } catch (error) {
      logger.warn("[DELETE] Could not verify user deletion: " + error);
    }

    logger.info("[DELETE] ✓ Successfully completed deletion process for user: " + userId);
    logger.info("[DELETE] ========================================");
    return JSON.stringify({ success: true });
  } catch (error) {
    logger.error("[DELETE] ✗ Error deleting user data: " + error);
    logger.info("[DELETE] ========================================");
    return JSON.stringify({ success: false, error: String(error) });
  }
};
