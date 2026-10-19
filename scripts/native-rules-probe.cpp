// Test-only executable: exercises actual native move generation without search/evaluation.
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include "bit.hpp"
#include "fen.hpp"
#include "gen.hpp"
#include "list.hpp"
#include "move.hpp"
#include "pos.hpp"
#include "var.hpp"

int main(int argc, char * argv[]) {
   var::init();
   var::set("variant", "nigerian");
   var::update();
   bit::init();
   if (argc > 1 && std::string(argv[1]) == "--list-boundaries") {
      for (int count : {128, 129, 154, 512}) {
         List moves;
         for (int i = 0; i < count; i++) {
            moves.add(move::make(square_from_std(1), square_from_std(6)));
            moves.set_score(i, i % 100);
         }
         moves.sort();
         List copy(moves);
         copy.sort();
         if (copy.size() != count || copy.score(0) != 99 || copy.score(count - 1) != 0) return 4;
         copy.clear();
         copy.add(move::make(square_from_std(1), square_from_std(6)));
         if (copy.size() != 1) return 5;
         std::cout << count << " ";
      }
      std::cout << std::endl;
      return 0;
   }
   std::string line;
   while (std::getline(std::cin, line)) {
      std::istringstream input(line);
      std::string fen, token;
      input >> fen;
      std::vector<Node> nodes;
      nodes.reserve(512); // Parent pointers remain stable for test histories.
      nodes.emplace_back(pos_from_hub(fen));
      while (input >> token) {
         if (nodes.size() == nodes.capacity()) return 2;
         Move mv = move::from_hub(token, nodes.back());
         if (!move::is_legal(mv, nodes.back())) return 3;
         nodes.push_back(nodes.back().succ(mv));
      }
      const Node & node = nodes.back();
      const Pos & pos = node;
      List moves;
      gen_moves(moves, pos);
      // Exercise the sentinel and overflow storage as well as generation.
      for (int i = 0; i < moves.size(); i++) moves.set_score(i, i % 100);
      moves.sort();
      List copy(moves);
      copy.sort();
      std::cout << "end=" << node.is_end() << " draw=" << node.is_draw(3);
      for (Move mv : copy) std::cout << " " << move::to_hub(mv, pos);
      std::cout << std::endl;
   }
}
