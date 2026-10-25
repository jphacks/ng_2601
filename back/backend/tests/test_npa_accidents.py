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
