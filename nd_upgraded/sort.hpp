
#ifndef SORT_HPP
#define SORT_HPP

// includes

#include "common.hpp"
#include "libmy.hpp"

class List;
class Pos;

// constants

const int Killer_Depth {100};

// functions

void sort_clear ();

// History with depth² scaling (stronger = better ordering)
void good_move (Move mv, const Pos & pos);
void good_move (Move mv, const Pos & pos, int depth);
void bad_move  (Move mv, const Pos & pos);
void bad_move  (Move mv, const Pos & pos, int depth);

// Killer moves
void killer_clear ();
void killer_store (Move mv, int ply);
bool killer_is    (Move mv, int ply, int slot = -1);

// Countermove heuristic
void  counter_store (Move mv, Move_Index opp_index);
Move  counter_get   (Move_Index opp_index);

// Sort with all heuristics
void sort_moves (List & list, const Pos & pos, Move_Index tt_move);
void sort_moves (List & list, const Pos & pos, Move_Index tt_move, int ply);
void sort_moves (List & list, const Pos & pos, Move_Index tt_move, int ply, Move counter);

#endif // !defined SORT_HPP
