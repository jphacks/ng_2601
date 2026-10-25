import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).parents[2] / "scripts" / "data" / "download_npa_accidents.py"
SPEC = importlib.util.spec_from_file_location("download_npa_accidents", SCRIPT)
assert SPEC and SPEC.loader
npa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(npa)


def test_coordinate_dms_converts_packed_npa_value() -> None:
    assert npa.coordinate_dms("430607590") == 43 + 6 / 60 + 7.590 / 3600


def test_bicycle_party_codes_exclude_passenger_car() -> None:
    assert "03" not in npa.BICYCLE_PARTY_CODES
    assert npa.BICYCLE_PARTY_CODES == {"51", "52"}


def test_normalize_preserves_japan_local_time_and_window(tmp_path):
    import csv, json
    raw = tmp_path / "honhyo_2025.csv"
    row = {"地点　緯度（北緯）": "350000000", "地点　経度（東経）": "1360000000", "発生日時　　年": "2025", "発生日時　　月": "1", "発生日時　　日": "2", "発生日時　　時": "9", "発生日時　　分": "30"}
    with raw.open("w", encoding="cp932", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=list(row))
        writer.writeheader(); writer.writerow(row)
    normalized = tmp_path / "npa.geojson"
    npa.normalize([(2025, raw)], normalized)
    result = json.loads(normalized.read_text())
    assert result["features"][0]["properties"]["observed_at"] == "2025-01-02T09:30:00+09:00"
    assert result["metadata"]["window"] == {"from":"2025-01-01", "to":"2025-12-31"}
