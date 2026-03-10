#!/usr/bin/env python3
"""
四子棋 (Connect Four) — built-in judge

Rules:
  - 6-row × 7-column board; player "0" uses X, player "1" uses O.
  - Player "0" moves first.
  - Each turn the active player drops a piece into one of the 7 columns (0-6).
    The piece falls to the lowest empty row in that column.
  - First player to connect 4 pieces horizontally, vertically, or diagonally wins.
  - If the board fills without a winner it is a draw (0.5 each).
  - Invalid move (column out of range or full column) → that player loses immediately.

Judge stdio protocol:
  stdin  line: {"round": N, "responses": {"<active_bot>": <column_index>}}
  stdout line: {"commands": {...}, "display": {...}, "verdict": "continue"|"finish",
               "scores": {...}, "debug": "..."}
"""

import json
import sys

ROWS = 6
COLS = 7


def drop_piece(board, col, mark):
    """Drop a piece into `col`. Returns the row it landed on, or -1 if full."""
    for row in range(ROWS - 1, -1, -1):
        if board[row][col] is None:
            board[row][col] = mark
            return row
    return -1  # column is full


def check_winner(board, mark):
    # Horizontal
    for r in range(ROWS):
        for c in range(COLS - 3):
            if all(board[r][c + i] == mark for i in range(4)):
                return True
    # Vertical
    for r in range(ROWS - 3):
        for c in range(COLS):
            if all(board[r + i][c] == mark for i in range(4)):
                return True
    # Diagonal ↘
    for r in range(ROWS - 3):
        for c in range(COLS - 3):
            if all(board[r + i][c + i] == mark for i in range(4)):
                return True
    # Diagonal ↙
    for r in range(ROWS - 3):
        for c in range(3, COLS):
            if all(board[r + i][c - i] == mark for i in range(4)):
                return True
    return False


def board_to_list(board):
    return [[cell if cell is not None else "." for cell in row] for row in board]


def main():
    board = [[None] * COLS for _ in range(ROWS)]
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
            col_raw = responses.get(active)
            try:
                col = int(col_raw)
            except (TypeError, ValueError):
                col = -1

            if col < 0 or col >= COLS:
                scores = {active: 0, other: 1}
                out = {
                    "commands": {},
                    "display": {"board": board_to_list(board), "winner": other},
                    "verdict": "finish",
                    "scores": scores,
                    "debug": f"player {active} chose invalid column ({col})",
                }
                print(json.dumps(out), flush=True)
                return

            row = drop_piece(board, col, marks[active])
            if row == -1:
                scores = {active: 0, other: 1}
                out = {
                    "commands": {},
                    "display": {"board": board_to_list(board), "winner": other},
                    "verdict": "finish",
                    "scores": scores,
                    "debug": f"player {active} chose full column ({col})",
                }
                print(json.dumps(out), flush=True)
                return

            if check_winner(board, marks[active]):
                scores = {active: 1, other: 0}
                out = {
                    "commands": {},
                    "display": {"board": board_to_list(board), "winner": active},
                    "verdict": "finish",
                    "scores": scores,
                    "debug": f"player {active} ({marks[active]}) wins at round {round_num}",
                }
                print(json.dumps(out), flush=True)
                return

            if all(board[0][c] is not None for c in range(COLS)):
                scores = {"0": 0.5, "1": 0.5}
                out = {
                    "commands": {},
                    "display": {"board": board_to_list(board), "winner": None},
                    "verdict": "finish",
                    "scores": scores,
                    "debug": "board full — draw",
                }
                print(json.dumps(out), flush=True)
                return

            active, other = other, active

        # Continue: request next move from the active player
        out = {
            "commands": {
                active: {
                    "board": board_to_list(board),
                    "your_mark": marks[active],
                    "cols": COLS,
                    "round": round_num,
                },
            },
            "display": {"board": board_to_list(board), "active_player": active},
            "verdict": "continue",
            "debug": f"round={round_num}, active={active}",
        }
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
