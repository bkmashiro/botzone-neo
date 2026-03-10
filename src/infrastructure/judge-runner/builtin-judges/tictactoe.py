#!/usr/bin/env python3
"""
井字棋 (Tic-Tac-Toe) — built-in judge

Rules:
  - 3×3 board; player "0" uses X, player "1" uses O.
  - Player "0" moves first.
  - Moves are 0-indexed integers 0-8 mapping to board positions:
      0 | 1 | 2
      3 | 4 | 5
      6 | 7 | 8
  - First player to complete a row, column, or diagonal wins.
  - If the board fills without a winner it is a draw (0.5 each).
  - Invalid move (out of range or occupied cell) → that player loses immediately.

Judge stdio protocol:
  stdin  line: {"round": N, "responses": {"<active_bot>": <cell_index>}}
  stdout line: {"commands": {...}, "display": {...}, "verdict": "continue"|"finish",
               "scores": {...}, "debug": "..."}
"""

import json
import sys

WINS = [
    (0, 1, 2), (3, 4, 5), (6, 7, 8),  # rows
    (0, 3, 6), (1, 4, 7), (2, 5, 8),  # columns
    (0, 4, 8), (2, 4, 6),              # diagonals
]


def check_winner(board, mark):
    return any(board[a] == mark and board[b] == mark and board[c] == mark for a, b, c in WINS)


def board_str(board):
    symbols = {None: ".", "X": "X", "O": "O"}
    cells = [symbols[b] for b in board]
    return f"{cells[0]}|{cells[1]}|{cells[2]}\n{cells[3]}|{cells[4]}|{cells[5]}\n{cells[6]}|{cells[7]}|{cells[8]}"


def main():
    board = [None] * 9
    marks = {"0": "X", "1": "O"}
    active = "0"
    other = "1"
    round_num = 0

    while True:
        line = sys.stdin.readline()
        if not line:
            break

        msg = json.loads(line.strip())
        responses = msg.get("responses", {})
        round_num = msg["round"]

        if responses:
            cell_raw = responses.get(active)
            try:
                cell = int(cell_raw)
            except (TypeError, ValueError):
                cell = -1

            # Validate move
            if cell < 0 or cell > 8 or board[cell] is not None:
                scores = {active: 0, other: 1}
                out = {
                    "commands": {},
                    "display": {"board": board_str(board), "winner": other},
                    "verdict": "finish",
                    "scores": scores,
                    "debug": f"player {active} made invalid move ({cell})",
                }
                print(json.dumps(out), flush=True)
                return

            board[cell] = marks[active]

            if check_winner(board, marks[active]):
                scores = {active: 1, other: 0}
                out = {
                    "commands": {},
                    "display": {"board": board_str(board), "winner": active},
                    "verdict": "finish",
                    "scores": scores,
                    "debug": f"player {active} ({marks[active]}) wins",
                }
                print(json.dumps(out), flush=True)
                return

            if all(c is not None for c in board):
                scores = {"0": 0.5, "1": 0.5}
                out = {
                    "commands": {},
                    "display": {"board": board_str(board), "winner": None},
                    "verdict": "finish",
                    "scores": scores,
                    "debug": "draw",
                }
                print(json.dumps(out), flush=True)
                return

            active, other = other, active

        # Continue: request next move from the active player only
        out = {
            "commands": {
                active: {
                    "board": board,
                    "your_mark": marks[active],
                    "round": round_num,
                },
            },
            "display": {"board": board_str(board), "active_player": active},
            "verdict": "continue",
            "debug": f"round={round_num}, active={active}",
        }
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
