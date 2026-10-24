from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WorkoutUpgradeTests(unittest.TestCase):
    def test_original_offline_features_are_preserved(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        for marker in ("gymLogs", "bodyWeightLogs", "saveSession", "renderCalendar", "renderStats", "Copy backup"):
            with self.subTest(marker=marker):
                self.assertIn(marker, html)

    def test_social_and_builder_are_wired(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        cloud = (ROOT / "cloud.js").read_text(encoding="utf-8")
        plan = (ROOT / "plan.js").read_text(encoding="utf-8")
        for marker in ("data-page=\"social\"", "id=\"page-social\"", "cloud.js", "cloud-config.js", "plan.js"):
            with self.subTest(marker=marker):
                self.assertIn(marker, html)
        for marker in ("signUp", "signIn", "friend_requests", "shared_workouts", "leaderboard_stats"):
            with self.subTest(marker=marker):
                self.assertIn(marker, cloud)
        self.assertIn("Workout builder", plan)

    def test_private_history_is_not_automatically_uploaded(self):
        cloud = (ROOT / "cloud.js").read_text(encoding="utf-8")
        self.assertNotIn("from('user_data')", cloud)
        self.assertNotIn("window.saveLogs=", cloud)
        self.assertIn("publishStats", cloud)
        self.assertIn("cloudShareWorkout", cloud)

    def test_database_tables_have_rls_and_friend_scoping(self):
        sql = (ROOT / "supabase" / "schema.sql").read_text(encoding="utf-8")
        for table in ("profiles", "friend_requests", "shared_workouts", "leaderboard_stats"):
            with self.subTest(table=table):
                self.assertIn("alter table public." + table + " enable row level security", sql)
        self.assertIn("Owner or accepted friends read shared workouts", sql)
        self.assertIn("Owner or friends read published stats", sql)


if __name__ == "__main__":
    unittest.main()
