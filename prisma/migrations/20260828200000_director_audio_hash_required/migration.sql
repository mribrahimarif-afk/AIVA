-- Strengthen triggers so AUDIO_TRANSCRIPT DirectorPlan strictly enforces:
-- 1. sourceTranscriptionId IS NOT NULL and belongs to the same project (projectId = NEW.projectId)
-- 2. sourceAudioHash IS NOT NULL and matches the referenced transcription's sourceAudioHash exactly
DROP TRIGGER IF EXISTS trg_director_plans_source_transcription_insert;
DROP TRIGGER IF EXISTS trg_director_plans_source_transcription_update;

CREATE TRIGGER trg_director_plans_source_transcription_insert
BEFORE INSERT ON director_plans
FOR EACH ROW
WHEN NEW.sourceType = 'AUDIO_TRANSCRIPT'
BEGIN
  SELECT CASE
    WHEN NEW.sourceTranscriptionId IS NULL OR NOT EXISTS (
      SELECT 1 FROM transcriptions
      WHERE id = NEW.sourceTranscriptionId AND projectId = NEW.projectId
    )
    THEN RAISE(ABORT, 'AUDIO_TRANSCRIPT DirectorPlan requires a valid sourceTranscriptionId belonging to the same project')
    WHEN NEW.sourceAudioHash IS NULL OR NOT EXISTS (
      SELECT 1 FROM transcriptions
      WHERE id = NEW.sourceTranscriptionId AND sourceAudioHash = NEW.sourceAudioHash
    )
    THEN RAISE(ABORT, 'AUDIO_TRANSCRIPT DirectorPlan requires sourceAudioHash matching the referenced transcription')
  END;
END;

CREATE TRIGGER trg_director_plans_source_transcription_update
BEFORE UPDATE ON director_plans
FOR EACH ROW
WHEN NEW.sourceType = 'AUDIO_TRANSCRIPT'
BEGIN
  SELECT CASE
    WHEN NEW.sourceTranscriptionId IS NULL OR NOT EXISTS (
      SELECT 1 FROM transcriptions
      WHERE id = NEW.sourceTranscriptionId AND projectId = NEW.projectId
    )
    THEN RAISE(ABORT, 'AUDIO_TRANSCRIPT DirectorPlan requires a valid sourceTranscriptionId belonging to the same project')
    WHEN NEW.sourceAudioHash IS NULL OR NOT EXISTS (
      SELECT 1 FROM transcriptions
      WHERE id = NEW.sourceTranscriptionId AND sourceAudioHash = NEW.sourceAudioHash
    )
    THEN RAISE(ABORT, 'AUDIO_TRANSCRIPT DirectorPlan requires sourceAudioHash matching the referenced transcription')
  END;
END;
