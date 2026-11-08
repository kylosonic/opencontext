"""Settings.from_env tests (monkeypatched environment, no real env access)."""

from pathlib import Path

from oc_worker.config import Settings

_ENV_KEYS = [
    "WORKER_API_URL",
    "WORKER_API_TOKEN",
    "WORKER_ID",
    "WORKER_CONCURRENCY",
    "TRANSCRIPTION_PROVIDER",
    "TRANSCRIPTION_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "VISION_PROVIDER",
    "VISION_MODEL",
    "OLLAMA_BASE_URL",
    "TEXT_PROVIDER",
    "TEXT_MODEL",
    "FFMPEG_PATH",
    "FFPROBE_PATH",
]


def _clear_env(monkeypatch) -> None:
    for key in _ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_defaults_with_empty_environment(monkeypatch) -> None:
    _clear_env(monkeypatch)
    settings = Settings.from_env()
    assert settings.worker_api_url == "http://localhost:3000"
    assert settings.worker_api_token == ""
    assert settings.worker_id == "oc-worker-1"
    assert settings.worker_concurrency == 1
    assert settings.transcription_provider == "openai_compatible"
    assert settings.transcription_model == "whisper-1"
    assert settings.openai_api_key == ""
    assert settings.openai_base_url == "https://api.openai.com/v1"
    assert settings.vision_provider == "openai_compatible"
    assert settings.vision_model == "gpt-4o-mini"
    assert settings.ollama_base_url == "http://localhost:11434"
    assert settings.text_provider == ""
    assert settings.text_model == "gpt-4o-mini"
    assert Path(settings.ffmpeg_path).is_file()
    assert settings.ffprobe_path == ""


def test_env_overrides_apply(monkeypatch) -> None:
    monkeypatch.setenv("WORKER_API_URL", "http://worker.internal:4000")
    monkeypatch.setenv("WORKER_API_TOKEN", "secret-token")
    monkeypatch.setenv("WORKER_ID", "worker-7")
    monkeypatch.setenv("WORKER_CONCURRENCY", "3")
    monkeypatch.setenv("TRANSCRIPTION_PROVIDER", "faster_whisper")
    monkeypatch.setenv("VISION_PROVIDER", "ollama")
    monkeypatch.setenv("TEXT_PROVIDER", "openai_compatible")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("FFMPEG_PATH", "C:\\tools\\ffmpeg.exe")
    monkeypatch.setenv("FFPROBE_PATH", "C:\\tools\\ffprobe.exe")
    settings = Settings.from_env()
    assert settings.worker_api_url == "http://worker.internal:4000"
    assert settings.worker_api_token == "secret-token"
    assert settings.worker_id == "worker-7"
    assert settings.worker_concurrency == 3
    assert settings.transcription_provider == "faster_whisper"
    assert settings.vision_provider == "ollama"
    assert settings.text_provider == "openai_compatible"
    assert settings.openai_api_key == "sk-test"
    assert settings.ffmpeg_path == "C:\\tools\\ffmpeg.exe"
    assert settings.ffprobe_path == "C:\\tools\\ffprobe.exe"


def test_empty_string_is_treated_as_unset(monkeypatch) -> None:
    monkeypatch.setenv("WORKER_ID", "")
    monkeypatch.setenv("WORKER_API_TOKEN", "")
    monkeypatch.setenv("WORKER_CONCURRENCY", "")
    monkeypatch.setenv("TEXT_PROVIDER", "")
    settings = Settings.from_env()
    assert settings.worker_id == "oc-worker-1"
    assert settings.worker_api_token == ""
    assert settings.worker_concurrency == 1
    assert settings.text_provider == ""


def test_invalid_int_falls_back_to_default(monkeypatch) -> None:
    monkeypatch.setenv("WORKER_CONCURRENCY", "not-a-number")
    assert Settings.from_env().worker_concurrency == 1
    monkeypatch.setenv("WORKER_CONCURRENCY", "0")
    assert Settings.from_env().worker_concurrency == 0


def test_from_env_reads_current_process_environment(monkeypatch) -> None:
    monkeypatch.setenv("WORKER_ID", "env-worker")
    monkeypatch.setenv("WORKER_API_TOKEN", "tok")
    settings = Settings.from_env()
    assert settings.worker_id == "env-worker"
    assert settings.worker_api_token == "tok"


def test_ffmpeg_falls_back_to_bundled_binary(monkeypatch) -> None:
    monkeypatch.delenv("FFMPEG_PATH", raising=False)
    monkeypatch.setenv("PATH", "")
    settings = Settings()
    assert Path(settings.ffmpeg_path).is_file()
