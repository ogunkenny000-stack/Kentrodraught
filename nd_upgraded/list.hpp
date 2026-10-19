#ifndef LIST_HPP
#define LIST_HPP

// includes

#include "common.hpp"
#include "libmy.hpp"
#include <vector>

class Pos;

// types

class List {

private:

   static const int Size{ 128 };

   int m_capture_score{ 0 };
   int m_size{ 0 };
   Move m_move[Size];
   int16 m_score[Size + 1]; // sort() writes a sentinel after the last score
   // Keep the allocation-free common case. Free-choice captures can exceed
   // Scan's original maximum-capture move-list bound.
   std::vector<Move> m_overflow_move;
   std::vector<int16> m_overflow_score;

public:

   List() = default;

   List(const List & list) { copy(list); }
   void operator = (const List & list) { copy(list); }

   void clear() { m_capture_score = 0; m_size = 0; }
   void add(Move mv);

   void add_move(Square from, Square to);
   void add_capture(Square from, Square to, Bit caps, const Pos & pos, int king);

   void set_size(int size);
   void set_score(int i, int sc);

   void move_to_front(int i);
   void shuffle();
   void sort();
   void sort_static(const Pos & pos);

   int  size()      const { return m_size; }
   Move move(int i) const { assert(i >= 0 && i < m_size); return moves()[i]; }
   int  score(int i) const { assert(i >= 0 && i < m_size); return scores()[i]; }
   Move operator [] (int i) const { return move(i); }

   const Move * begin() const { return moves(); }
   const Move * end() const { return moves() + m_size; }

private:

   static uint64 move_order(Move mv, const Pos & pos);

   void copy(const List & list);
   void reserve(int capacity);
   Move * moves() { return m_overflow_move.empty() ? m_move : m_overflow_move.data(); }
   const Move * moves() const { return m_overflow_move.empty() ? m_move : m_overflow_move.data(); }
   int16 * scores() { return m_overflow_score.empty() ? m_score : m_overflow_score.data(); }
   const int16 * scores() const { return m_overflow_score.empty() ? m_score : m_overflow_score.data(); }
};

// functions

namespace list {

   int pick(const List & list, double k);

   bool has(const List & list, Move mv);
   int  find(const List & list, Move mv);
   Move find_index(const List & list, Move_Index index, const Pos & pos);

   void disp(const List & list, const Pos & pos, double k = 1.0);

} // namespace list

#endif // !defined LIST_HPP

