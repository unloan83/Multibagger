from datetime import date

from engine.backfill import month_chunks


def test_month_chunks_cover_range_without_overlap():
    chunks = list(month_chunks(date(2022, 1, 1), date(2022, 3, 4)))
    assert chunks == [(date(2022, 1, 1), date(2022, 1, 31)),
                      (date(2022, 2, 1), date(2022, 2, 28)),
                      (date(2022, 3, 1), date(2022, 3, 4))]
