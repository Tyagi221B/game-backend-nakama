/// <reference path="../node_modules/nakama-runtime/index.d.ts" />

// types.ts - Type definitions and constants for Tic-Tac-Toe game
// Separating types from logic for better code organization and maintainability

// ==================== GAME MODE ====================

// Game mode types
type GameMode = "classic" | "timed";

// ==================== GAME STATE ====================

// Game state structure - represents the complete state of a tic-tac-toe match
// This is passed between all match handler functions
interface GameState {
  board: (string | null)[];      // 9 cells representing 3x3 grid: null (empty), "X", or "O"
  currentTurn: string | null;    // User ID of the player whose turn it is
  players: {                     // Map of player data indexed by user ID
    [userId: string]: {
      username: string;          // Display name
      symbol: "X" | "O";         // Which symbol this player uses
      connected: boolean;        // Connection status
    };
  };
  status: "waiting" | "active" | "completed";  // Current game phase
  winner: string | null;         // User ID of winner, "draw", or null if game ongoing
  mode: GameMode;                // Game mode: "classic" (no timer) or "timed" (30s per turn)
  createdAt: number;            // Timestamp when match was created
  turnStartTimestamp: number | null;  // Timestamp when current turn started (for timeout detection)
}

// ==================== MESSAGE OPCODES ====================

// Operation codes for client-server communication
// These identify the type of message being sent
const enum OpCode {
  STATE_UPDATE = 1,    // Server → Client: "Here's the updated game state"
  MAKE_MOVE = 2,       // Client → Server: "I want to make a move at position X"
}
