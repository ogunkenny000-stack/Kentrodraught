import glicko2 from 'glicko2';

export interface PlayerRating {
  rating: number;
  rd: number;
  vol: number;
}

const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;
const DEFAULT_VOL = 0.06;

export const defaultPlayerRating: PlayerRating = {
  rating: DEFAULT_RATING,
  rd: DEFAULT_RD,
  vol: DEFAULT_VOL
};

export function calculateRating(
  player1: PlayerRating,
  player2: PlayerRating,
  score: number // 1 for player1 win, 0.5 for draw, 0 for player1 loss
): { newPlayer1: PlayerRating; newPlayer2: PlayerRating; diff1: number; diff2: number } {
  const glicko = new glicko2.Glicko2({
    tau: 0.5,
    rating: DEFAULT_RATING,
    rd: DEFAULT_RD,
    vol: DEFAULT_VOL
  });

  const p1 = glicko.makePlayer(player1.rating, player1.rd, player1.vol);
  const p2 = glicko.makePlayer(player2.rating, player2.rd, player2.vol);

  glicko.addMatch(p1, p2, score);
  glicko.calculatePlayersRatings();

  const newP1: PlayerRating = {
    rating: p1.getRating(),
    rd: p1.getRd(),
    vol: p1.getVol()
  };

  const newP2: PlayerRating = {
    rating: p2.getRating(),
    rd: p2.getRd(),
    vol: p2.getVol()
  };

  return {
    newPlayer1: newP1,
    newPlayer2: newP2,
    diff1: newP1.rating - player1.rating,
    diff2: newP2.rating - player2.rating
  };
}
