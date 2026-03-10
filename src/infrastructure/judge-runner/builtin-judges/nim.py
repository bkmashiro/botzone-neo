#!/usr/bin/env python3
"""
Nim 取石子 — built-in judge

Rules:
  - Start with 21 stones.
  - Players alternate turns; player "0" moves first.
  - Each turn the active player takes 1, 2, or 3 stones.
  - The player who takes the LAST stone LOSES.
  - Invalid move (not 1-3, or more than remaining) → that player loses.

Judge stdio protocol:
  stdin  line: {"round": N, "responses": {"<active_bot>": <stones_taken>}}
  stdout line: {"commands": {...}, "display": {...}, "verdict": "continue"|"finish",
               "scores": {...}, "debug": "..."}
"""

import json
import sys

INITIAL_STONES = 21


def main():
    stones = INITIAL_STONES
    # 0 moves first
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
            taken_raw = responses.get(active)
            try:
                taken = int(taken_raw)
            except (TypeError, ValueError):
                taken = 0

            if taken < 1 or taken > 3 or taken > stones:
                # Invalid move — active player loses
                scores = {active: 0, other: 1}
                out = {
                    "commands": {},
                    "display": {"stones_left": stones, "winner": other},
                    "verdict": "finish",
                    "scores": scores,
                    "debug": f"player {active} made invalid move ({taken}), stones_left={stones}",
                }
                print(json.dumps(out), flush=True)
                return

            stones -= taken

            if stones == 0:
                # Took the last stone → loses
                scores = {active: 0, other: 1}
                out = {
                    "commands": {},
                    "display": {"stones_left": 0, "winner": other},
                    "verdict": "finish",
                    "scores": scores,
                    "debug": f"player {active} took last stone — player {other} wins",
                }
                print(json.dumps(out), flush=True)
                return

            # Swap turns
            active, other = other, active

        # Continue: request next move from the active player only
        out = {
            "commands": {
                active: {"stones_left": stones, "your_turn": True},
            },
            "display": {"stones_left": stones, "active_player": active},
            "verdict": "continue",
            "debug": f"round={round_num}, stones_left={stones}, active={active}",
        }
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
