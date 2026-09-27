import unittest
from trend_collector.normalize import clean_display_keyword, normalize_keyword

class NormalizeTests(unittest.TestCase):
    def test_rank_prefix(self):
        self.assertEqual(clean_display_keyword("1. 곽빈"), "곽빈")

    def test_spacing(self):
        self.assertEqual(normalize_keyword("아시안  게임/야구"), "아시안 게임 야구")

    def test_nfkc(self):
        self.assertEqual(normalize_keyword("ＡＢＣ"), "abc")

if __name__ == "__main__":
    unittest.main()
