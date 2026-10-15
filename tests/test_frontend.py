"""Kiểm tra hợp đồng tĩnh giữa HTML, CSS và các module frontend."""

import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND = PROJECT_ROOT / "frontend"
EXPECTED_PAGES = {"home", "face-lab", "arena", "health-hub", "aura-ai", "progress", "my-aura"}
DYNAMIC_IDS = {
    "arena-status", "arena-leaderboard-state", "arena-load-more", "arena-save-message",
    "arena-profile-form", "arena-profile-content", "arena-profile-skeleton",
    "arena-leaderboard-list", "arena-history",
    "arena-bot-list", "arena-bot-selected", "arena-bot-start", "arena-bot-summary", "arena-bot-history",
    "habit-entry-form", "open-delete-dialog", "consent-saving", "logout-button",
    "habit-unit", "habit-value", "habit-note", "habit-category", "habit-records",
    "face-stop-camera", "face-camera-chip", "face-camera-empty", "face-analyze",
    "face-result-content", "face-live-state", "face-guide-frame", "face-overlay",
    "face-video", "face-start-camera", "face-result-empty", "face-live-message",
    "face-switch-camera", "face-progress", "face-light-sampler", "face-camera-stage",
    "face-bot-battle-outcome",
    "switch-auth-mode", "auth-submit", "auth-dialog", "auth-email", "auth-title",
    "auth-switch-copy", "auth-description", "auth-form", "auth-confirm-wrap",
    "auth-confirm", "delete-form", "close-delete", "auth-password", "delete-password",
    "delete-dialog", "delete-confirm", "close-auth",
}


class FrontendMarkup(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.pages: set[str] = set()
        self.nav: set[str] = set()
        self.assets: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        values = dict(attrs)
        if "id" in values:
            self.ids.append(values["id"])
        if "data-page" in values:
            self.pages.add(values["data-page"])
        if "data-nav" in values:
            self.nav.add(values["data-nav"])
        if tag in {"script", "link"}:
            asset = values.get("src") or values.get("href")
            if asset and not asset.startswith(("http://", "https://", "#")):
                self.assets.append(asset)


class FrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (FRONTEND / "index.html").read_text(encoding="utf-8")
        cls.css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
        cls.markup = FrontendMarkup()
        cls.markup.feed(cls.html)
        cls.modules = list((FRONTEND / "js").rglob("*.js")) + [FRONTEND / "app.js"]
        cls.source = "\n".join(path.read_text(encoding="utf-8") for path in cls.modules)

    def test_all_pages_have_matching_navigation(self) -> None:
        self.assertEqual(self.markup.pages, EXPECTED_PAGES)
        self.assertEqual(self.markup.nav, EXPECTED_PAGES)
        self.assertEqual(len(self.markup.ids), len(set(self.markup.ids)), "HTML id phải duy nhất.")

    def test_html_assets_and_javascript_imports_exist(self) -> None:
        for asset in self.markup.assets:
            self.assertTrue((FRONTEND / asset).is_file(), f"Thiếu tài nguyên: {asset}")
        for path in self.modules:
            source = path.read_text(encoding="utf-8")
            for imported in re.findall(r"from\s+['\"]([^'\"]+)['\"]", source):
                if imported.startswith("."):
                    self.assertTrue((path.parent / imported).resolve().is_file(), f"Module import không tồn tại: {imported}")
        self.assertTrue((FRONTEND / "assets" / "face-landmarks.svg").is_file())

    def test_javascript_element_selectors_match_html_ids(self) -> None:
        selectors = set(re.findall(r"querySelector(?:All)?\(['\"]#([\w-]+)", self.source))
        self.assertLessEqual(selectors, set(self.markup.ids) | DYNAMIC_IDS)

    def test_sensitive_data_is_not_persisted_in_browser(self) -> None:
        theme_module = (FRONTEND / "js" / "theme.js").read_text(encoding="utf-8")
        performance_module = (FRONTEND / "js" / "performance.js").read_text(encoding="utf-8")
        application_source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in self.modules
            if path not in {FRONTEND / "js" / "theme.js", FRONTEND / "js" / "performance.js"}
        )
        for storage in ("localStorage", "sessionStorage", "indexedDB"):
            self.assertNotIn(storage, application_source)
        self.assertIn('const STORAGE_KEY = "auramaxx-theme"', theme_module)
        self.assertIn("localStorage.setItem(STORAGE_KEY, theme)", theme_module)
        self.assertIn('const STORAGE_KEY = "auramaxx-performance-mode"', performance_module)
        self.assertIn('const MODES = ["auto", "economy", "balanced", "quality"]', performance_module)
        self.assertIn("localStorage.setItem(STORAGE_KEY, mode)", performance_module)
        self.assertEqual(performance_module.count("localStorage.setItem("), 1)
        self.assertNotIn("AI_API_KEY", self.source)

    def test_native_face_lab_uses_original_server_engine(self) -> None:
        face = (FRONTEND / "js/pages/face-lab-native.js").read_text(encoding="utf-8")
        self.assertNotIn("iframe", self.source)
        self.assertNotIn("initVisionFace", self.source)
        self.assertNotIn("measureFaceProfile", face)
        for endpoint in ("process", "register", "faces", "challenge/start", "analyze_face"):
            self.assertIn("/api/vision/" + endpoint, face)
        camera = (FRONTEND / "js/face/camera.js").read_text(encoding="utf-8")
        self.assertIn("getUserMedia", camera)
        for capability in ("detectForVideo", 'createLandmarker("IMAGE")', "stream.getTracks()", "NotReadableError", "faces.length > 1", "front.poseYaw".replace(".", "?.", 1)):
            self.assertIn(capability, face)
        self.assertIn("URL.revokeObjectURL", face)
        self.assertIn("submitArenaBattle()", face)
        battle = (FRONTEND / "js/arena/battle.js").read_text(encoding="utf-8")
        self.assertIn("reportToArenaGroups(report)", battle)
        pose = (FRONTEND / "js/face/capture-pose.js").read_text(encoding="utf-8")
        original = (PROJECT_ROOT / "assets/app.js").read_text(encoding="utf-8")
        for name in ("calcDistance", "calculateHeadPose", "evaluateCapturePose"):
            pattern = r"function " + name + r"\([\s\S]*?\n    }"
            self.assertEqual(re.search(pattern, pose).group(), re.search(pattern, original).group())

    def test_old_login_layout_is_reused_with_one_session(self) -> None:
        login = (PROJECT_ROOT / "login.html").read_text(encoding="utf-8")
        for component in ("auth-shell", "journey-steps", "auth-panel", "loginForm"):
            self.assertIn(component, login)
        self.assertNotIn('id="auth-dialog"', self.html)
        self.assertNotIn("admin-login.html", login)
        self.assertIn('/login.js', login)

    def test_responsive_layout_and_reduced_motion(self) -> None:
        for breakpoint in ("max-width:1080px", "max-width:760px", "max-width:560px"):
            self.assertIn(breakpoint, self.css)
        self.assertIn("prefers-reduced-motion:reduce", self.css)


if __name__ == "__main__":
    unittest.main()
