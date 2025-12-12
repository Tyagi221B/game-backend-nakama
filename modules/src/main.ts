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
