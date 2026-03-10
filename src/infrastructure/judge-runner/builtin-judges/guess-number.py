#!/usr/bin/env python3
"""
猜数字 (Guess Number) — built-in judge

Rules:
  - 5 rounds, both players guess a number between 1 and 100 simultaneously.
  - The player whose guess is closer to the secret number wins that round.
  - Ties (equal distance) award no point to either player.
  - After 5 rounds, the player with more round-wins wins the match.
  - Draw → scores {"0": 0.5, "1": 0.5}.

Judge stdio protocol:
  stdin  line: {"round": N, "responses": {"0": <guess>, "1": <guess>}}
  stdout line: {"commands": {...}, "display": {...}, "verdict": "continue"|"finish",
               "scores": {...}, "debug": "..."}

First call has empty responses (game init); judge replies with round-1 commands.
"""

import json
import sys
import random

ROUNDS = 5
LOW = 1
HIGH = 100


def main():
    secret = random.randint(LOW, HIGH)
    round_wins = {"0": 0, "1": 0}
    current_round = 0

    while True:
        line = sys.stdin.readline()
        if not line:
            break

        msg = json.loads(line.strip())
        round_num = msg["round"]
        responses = msg.get("responses", {})

        if responses:
            # Evaluate previous guesses
            g0 = int(responses.get("0", 0))
            g1 = int(responses.get("1", 0))
            d0 = abs(g0 - secret)
            d1 = abs(g1 - secret)
            if d0 < d1:
                round_wins["0"] += 1
            elif d1 < d0:
                round_wins["1"] += 1
            # tie: no points

        current_round = round_num

        if current_round >= ROUNDS and responses:
            # Game over
            w0 = round_wins["0"]
            w1 = round_wins["1"]
            if w0 > w1:
                scores = {"0": 1, "1": 0}
            elif w1 > w0:
                scores = {"0": 0, "1": 1}
            else:
                scores = {"0": 0.5, "1": 0.5}

            out = {
                "commands": {},
                "display": {"secret": secret, "round_wins": round_wins},
                "verdict": "finish",
                "scores": scores,
                "debug": f"secret={secret}, wins={round_wins}",
            }
            print(json.dumps(out), flush=True)
            break
        else:
            # Continue: ask both bots to guess
            out = {
                "commands": {
                    "0": {"round": current_round, "rounds": ROUNDS, "range": [LOW, HIGH]},
                    "1": {"round": current_round, "rounds": ROUNDS, "range": [LOW, HIGH]},
                },
                "display": {"round": current_round, "rounds": ROUNDS},
                "verdict": "continue",
                "debug": f"secret={secret}, round={current_round}",
            }
            print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
