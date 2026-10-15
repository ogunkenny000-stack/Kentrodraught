// Fixture adapter for the actual engine move generator and position state.
// Protocol: one SCAN hub/FEN position followed by optional hub moves per line.
#include <algorithm>
#include <deque>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include "bit.hpp"
#include "fen.hpp"
#include "gen.hpp"
#include "list.hpp"
#include "move.hpp"
#include "pos.hpp"
#include "var.hpp"

static void require(bool cond, const char * message) {
   if (!cond) throw std::runtime_error(message);
}

static void test_list() {
   // Exercise the old sentinel boundary, first spill, further growth, copies,
   // score preservation, truncation, and reuse after clearing.
   for (int size : {128, 129, 513}) {
      List list;
      for (int i = 0; i < size; i++) {
         list.add(Move(i + 1));
         list.set_score(i, i);
      }
      List copy(list);
      copy = copy;
      list.clear();
      list = copy;
      list.sort();
      require(list.size() == size, "List spill lost moves");
      for (int i = 0; i < size; i++) {
         require(list[i] == Move(size - i), "List sort/copy corrupted moves");
         require(list.score(i) == size - i - 1, "List sort/copy corrupted scores");
      }
      list.move_to_front(size - 1);
      require(list[0] == Move(1), "List move_to_front failed after spill");
      list.shuffle();
      list.set_size(1);
      list.clear();
      list.add(Move(17));
      require(list.size() == 1 && list[0] == Move(17), "List spill reuse failed");
   }
}

int main() {
   try {
      var::init();
      var::set("variant", "nigerian");
      var::update();
      bit::init();
      test_list();
      std::string line;
      while (std::getline(std::cin, line)) {
         std::istringstream input(line);
         std::string fen;
         input >> fen;
         if (fen.empty()) continue;
         std::deque<Node> nodes;
         nodes.emplace_back(fen.find(':') == std::string::npos ? pos_from_hub(fen) : pos_from_fen(fen));
         std::string token;
         while (input >> token) {
            Move mv = move::from_hub(token, nodes.back());
            require(move::is_legal(mv, nodes.back()), "Illegal fixture history move");
            nodes.push_back(nodes.back().succ(mv));
         }
         const Node & node = nodes.back();
         List list;
         gen_moves(list, node);
         for (int i = 0; i < list.size(); i++) list.set_score(i, i);
         list.sort(); // Exercise real high-mobility positions, including exact capacity.
         List copy(list);
         std::cout << "{\"draw\":" << (node.is_draw(3) ? "true" : "false")
                   << ",\"end\":" << (node.is_end() ? "true" : "false")
                   << ",\"fen\":\"" << pos_hub(node) << "\",\"moves\":[";
         bool first = true;
         for (Move mv : copy) {
            if (!first) std::cout << ',';
            first = false;
            std::cout << "{\"move\":\"" << move::to_hub(mv, node)
                      << "\",\"fen\":\"" << pos_hub(static_cast<const Pos &>(node).succ(mv)) << "\"}";
         }
         std::cout << "]}" << std::endl;
      }
   } catch (const std::exception & error) {
      std::cerr << error.what() << std::endl;
      return 1;
   }
}
