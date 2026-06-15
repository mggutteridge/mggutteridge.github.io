import requests
from bs4 import BeautifulSoup
import json
from datetime import datetime

URL = "https://www.espn.co.uk/football/stats/_/league/FIFA.WORLD/view/discipline/season/2026"

HEADERS = {
    "User-Agent": "Mozilla/5.0"
}

def fetch_page():
    r = requests.get(URL, headers=HEADERS)
    r.raise_for_status()
    return r.text

def parse_cards(html):
    soup = BeautifulSoup(html, "html.parser")

    tables = soup.find_all("table")
    rows_mapped = 0

    cards = {}

    for table in tables:
        tbody = table.find("tbody")
        if not tbody:
            continue

        for row in tbody.find_all("tr"):
            cols = [td.get_text(strip=True) for td in row.find_all("td")]

            # ESPN discipline tables are usually:
            # 0: rank, 1: team, 2+: stats
            if len(cols) < 4:
                continue

            team = cols[1]

            try:
                yellow = int(cols[2])
                red = int(cols[4]) if len(cols) > 4 else 0
            except ValueError:
                continue

            cards[team] = {
                "yellow": yellow,
                "secondYellow": 0,
                "straightRed": red
            }

            rows_mapped += 1

    return cards, rows_mapped


def main():
    html = fetch_page()
    cards, rows_mapped = parse_cards(html)

    output = {
        "source": "ESPN FIFA World Cup discipline stats",
        "updatedAt": datetime.utcnow().isoformat(),
        "scoring": {
            "yellow": 1,
            "red": 2
        },
        "diagnostics": {
            "rowsMapped": rows_mapped,
        },
        "cards": cards
    }

    with open("cards.json", "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"✅ Updated {rows_mapped} rows")


if __name__ == "__main__":
    main()
