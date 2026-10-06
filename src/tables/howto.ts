/**
 * OWNER: growth
 * The "how to play" lines of the board games, shown on an open table before its board has loaded.
 * Plain text only, so it costs nothing to ship with the Tables app.
 */
export const chessRules: readonly string[] = [
  'Two players: White moves first. Tap one of your pieces to see where it can go, then tap a square (or drag the piece).',
  'Win by checkmate: the other king is attacked and cannot escape. The game is a draw by stalemate, by repeating a position three times, after fifty moves with no capture or pawn move, or when neither side can mate.',
  'Castling, en passant and promotion (you choose the new piece) all work as in the standard rules.',
  'Pick a clock when you sit down: 5 minutes plus 3 seconds a move, 10 minutes, or a relaxed three minutes a move. Run out of time and you lose.',
  'You can resign, or offer a draw that the other player may accept. A bot never accepts a draw offer: it plays on.',
  'A win against a real player is paid by the game. A game against the computer pays nothing.',
]
export const weaveRules: readonly string[] = [
  'Two to four players take turns laying lettered tiles on the cloth to make words, crossword style. Everyone holds seven tiles that nobody else can see.',
  'Your tiles must go in one row or one column and join up with the tiles already there. The first word covers the middle square.',
  'Every word you make, in both directions, must be in the word list. Tiles on bonus squares double or triple a letter or the whole word.',
  'Use all seven tiles in one turn for a bonus. A blank tile can be any letter and scores nothing.',
  'You can swap tiles for new ones (while the bag has at least seven) or pass. The game ends when someone runs out of tiles with the bag empty, or after six turns in a row with no score.',
  'You have two minutes for each turn. A win against real players is paid by the game; a game against bots pays nothing.',
]
