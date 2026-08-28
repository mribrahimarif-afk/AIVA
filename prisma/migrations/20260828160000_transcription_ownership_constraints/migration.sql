-- Enforce that activeTranscriptionId on audio_sources must reference a Transcription owned by that exact AudioSource
CREATE TRIGGER IF NOT EXISTS trg_audio_sources_active_transcription_insert
BEFORE INSERT ON audio_sources
FOR EACH ROW
WHEN NEW.activeTranscriptionId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM transcriptions
      WHERE id = NEW.activeTranscriptionId AND audioSourceId = NEW.id
    )
    THEN RAISE(ABORT, 'activeTranscriptionId must reference a Transcription owned by this AudioSource')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_audio_sources_active_transcription_update
BEFORE UPDATE OF activeTranscriptionId ON audio_sources
FOR EACH ROW
WHEN NEW.activeTranscriptionId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM transcriptions
      WHERE id = NEW.activeTranscriptionId AND audioSourceId = NEW.id
    )
    THEN RAISE(ABORT, 'activeTranscriptionId must reference a Transcription owned by this AudioSource')
  END;
END;

-- Enforce that AUDIO_TRANSCRIPT DirectorPlans require a valid existing sourceTranscriptionId
CREATE TRIGGER IF NOT EXISTS trg_director_plans_source_transcription_insert
BEFORE INSERT ON director_plans
FOR EACH ROW
WHEN NEW.sourceType = 'AUDIO_TRANSCRIPT'
BEGIN
  SELECT CASE
    WHEN NEW.sourceTranscriptionId IS NULL OR NOT EXISTS (
      SELECT 1 FROM transcriptions WHERE id = NEW.sourceTranscriptionId
    )
    THEN RAISE(ABORT, 'AUDIO_TRANSCRIPT DirectorPlan requires a valid sourceTranscriptionId')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_director_plans_source_transcription_update
BEFORE UPDATE ON director_plans
FOR EACH ROW
WHEN NEW.sourceType = 'AUDIO_TRANSCRIPT'
BEGIN
  SELECT CASE
    WHEN NEW.sourceTranscriptionId IS NULL OR NOT EXISTS (
      SELECT 1 FROM transcriptions WHERE id = NEW.sourceTranscriptionId
    )
    THEN RAISE(ABORT, 'AUDIO_TRANSCRIPT DirectorPlan requires a valid sourceTranscriptionId')
  END;
END;
