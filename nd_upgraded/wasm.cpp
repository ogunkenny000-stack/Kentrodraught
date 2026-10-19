// Browser adapter only: the existing Nigerian rules, search and weights are unchanged.
#include <emscripten.h>
#include <sstream>
#include "bit.hpp"
#include "hash.hpp"
#include "pos.hpp"
#include "var.hpp"
#include "bb_index.hpp"
#include "bb_comp.hpp"
#include "eval.hpp"
#include "fen.hpp"
#include "search.hpp"
#include "tt.hpp"

void listen_input() {}
bool has_input() { return false; }
bool peek_line(std::string &) { return false; }
bool get_line(std::string &) { return false; }

extern "C" {
EMSCRIPTEN_KEEPALIVE void ken_init() {
  bit::init(); hash::init(); pos::init(); var::init();
  bb::index_init(); bb::comp_init(); ml::rand_init();
  var::set("variant", "nigerian"); var::set("book", "false");
  var::set("threads", "1"); var::set("tt-size", "24"); var::set("bb-size", "0");
  var::update(); bit::init(); eval_init(); G_TT.set_size(var::TT_Size);
}
EMSCRIPTEN_KEEPALIVE const char * ken_search(const char * fen, double seconds, int depth, int pst) {
  static std::string result;
  var::set("eval", pst ? "pst" : "pattern"); var::update();
  // Evaluation changes invalidate cached scores from the previous mode.
  static int previous = -1;
  if (previous != pst) { G_TT.clear(); previous = pst; }
  Pos pos = pos_from_hub(fen);
  Search_Input si;
  // A forced move still needs a real evaluation. Move-only search can return
  // the internal "unknown score" sentinel without searching that position.
  si.move = false;
  si.book = false; si.input = false; si.time = seconds;
  si.depth = depth > 0 ? Depth(depth) : Depth_Max;
  Search_Output so; search(so, Node(pos), si);
  std::ostringstream out;
  out << "{\"move\":\"" << move::to_hub(so.move, pos) << "\",\"score\":" << int(so.score)
      << ",\"depth\":" << int(so.depth) << ",\"nodes\":" << so.node
      << ",\"pv\":\"" << so.pv.to_hub(pos) << "\"}";
  result = out.str(); return result.c_str();
}
}
