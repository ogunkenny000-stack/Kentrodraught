
// includes

#include <array>
#include <cmath>

#include "common.hpp"
#include "libmy.hpp"
#include "list.hpp"
#include "move.hpp"
#include "pos.hpp"
#include "sort.hpp"

// constants

const int Prob_Bit   {12};
const int Prob_One   {1 << Prob_Bit};
const int Prob_Half  {1 << (Prob_Bit - 1)};
const int Prob_Shift {4}; // smaller => more adaptive

// ── Score tiers (all must be < Prob_One = 4096) ──────────────────────────────
// TT move         : 4095  (highest)
// Capture (king)  : 4090
// Capture (man)   : 4085
// Killer slot 0   : 4080
// Killer slot 1   : 4075
// History         : 0..4095 mapped into 0..4070 band via scaling
// Countermove     : small bonus on top of history

// ── History table ─────────────────────────────────────────────────────────────
static std::array<int, Move_Index_Size> G_Hist;

// ── Killer move table: 2 slots per ply ───────────────────────────────────────
static Move G_Killer[Killer_Depth][2];

// ── Countermove table: indexed by opponent's last move index ──────────────────
static Move G_Counter[Move_Index_Size];

// functions

void sort_clear() {
   G_Hist.fill(Prob_Half);

   for (int i = 0; i < Killer_Depth; i++) {
      G_Killer[i][0] = move::None;
      G_Killer[i][1] = move::None;
   }

   for (int i = 0; i < Move_Index_Size; i++) {
      G_Counter[i] = move::None;
   }
}

// ── History updates with depth² bonus scaling ────────────────────────────────
// Deeper cutoffs get proportionally stronger history credit.

void good_move(Move mv, const Pos & pos, int depth) {
   Move_Index index = move::index(mv, pos);
   int bonus = std::min(depth * depth, 400); // cap to avoid saturation
   G_Hist[index] += (Prob_One - G_Hist[index]) * bonus / 512;
   if (G_Hist[index] >= Prob_One) G_Hist[index] = Prob_One - 1;
}

void bad_move(Move mv, const Pos & pos, int depth) {
   Move_Index index = move::index(mv, pos);
   int penalty = std::min(depth * depth, 400);
   G_Hist[index] -= G_Hist[index] * penalty / 512;
   if (G_Hist[index] < 0) G_Hist[index] = 0;
}

// Legacy wrappers (depth=1) for callers that don't have depth
void good_move(Move mv, const Pos & pos) { good_move(mv, pos, 4); }
void bad_move (Move mv, const Pos & pos) { bad_move (mv, pos, 4); }

// ── Killer moves ─────────────────────────────────────────────────────────────

void killer_clear() {
   for (int i = 0; i < Killer_Depth; i++) {
      G_Killer[i][0] = move::None;
      G_Killer[i][1] = move::None;
   }
}

void killer_store(Move mv, int ply) {
   if (ply < 0 || ply >= Killer_Depth) return;
   if (G_Killer[ply][0] == mv) return;    // already slot 0
   G_Killer[ply][1] = G_Killer[ply][0];   // shift down
   G_Killer[ply][0] = mv;
}

bool killer_is(Move mv, int ply, int slot) {
   if (ply < 0 || ply >= Killer_Depth) return false;
   if (slot == 0) return G_Killer[ply][0] == mv;
   if (slot == 1) return G_Killer[ply][1] == mv;
   return G_Killer[ply][0] == mv || G_Killer[ply][1] == mv;
}

// ── Countermove heuristic ────────────────────────────────────────────────────

void counter_store(Move mv, Move_Index opp_index) {
   if (opp_index == Move_Index_None) return;
   G_Counter[opp_index] = mv;
}

Move counter_get(Move_Index opp_index) {
   if (opp_index == Move_Index_None) return move::None;
   return G_Counter[opp_index];
}

// ── Main sort function ────────────────────────────────────────────────────────
// Priority order (highest first):
//   1. TT move
//   2. Captures (sorted by: king-capture > man-capture > fewer caps)
//   3. Killer slot 0
//   4. Killer slot 1
//   5. Countermove
//   6. History score

void sort_moves(List & list, const Pos & pos, Move_Index tt_move) {
   sort_moves(list, pos, tt_move, -1, move::None);
}

void sort_moves(List & list, const Pos & pos, Move_Index tt_move, int ply) {
   sort_moves(list, pos, tt_move, ply, move::None);
}

void sort_moves(List & list, const Pos & pos, Move_Index tt_move, int ply, Move counter) {

   if (list.size() <= 1) return;

   for (int i = 0; i < list.size(); i++) {

      Move mv = list[i];
      Move_Index index = move::index(mv, pos);

      int sc;

      if (index == tt_move) {

         sc = Prob_One - 1;  // TT move: absolute top priority

      } else if (move::is_capture(mv, pos)) {

         // MVV-LVA for captures:
         // Capturing a king is worth more than capturing a man.
         // More captures = better (in Nigerian free-choice rules).
         Bit caps = move::captured(mv, pos);
         int n_kings = bit::count(caps & pos.king());
         int n_men   = bit::count(caps & pos.man());
         // Map into 4085..4092 tier
         sc = 4085 + n_kings * 3 + n_men;
         if (sc >= Prob_One - 1) sc = Prob_One - 2;

      } else if (ply >= 0 && killer_is(mv, ply, 0)) {

         sc = Prob_One - 4;  // killer slot 0

      } else if (ply >= 0 && killer_is(mv, ply, 1)) {

         sc = Prob_One - 5;  // killer slot 1

      } else if (mv == counter) {

         // Countermove: slight boost above history, below killers
         sc = std::min(G_Hist[index] + (Prob_One >> 4), Prob_One - 6);

      } else {

         sc = G_Hist[index];  // history score: 0..Prob_One-1

      }

      // Clamp to valid range
      if (sc < 0)            sc = 0;
      if (sc >= Prob_One)    sc = Prob_One - 1;

      list.set_score(i, sc);
   }

   list.sort();
}
