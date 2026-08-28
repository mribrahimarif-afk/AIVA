-- Strengthen triggers so AUDIO_TRANSCRIPT DirectorPlan enforces:
-- 1. sourceTranscriptionId belongs to the same project (projectId = NEW.projectId)
-- 2. sourceAudioHash matches the referenced transcription's sourceAudioHash
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
    WHEN NEW.sourceAudioHash IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM transcriptions
      WHERE id = NEW.sourceTranscriptionId AND sourceAudioHash = NEW.sourceAudioHash
    )
    THEN RAISE(ABORT, 'AUDIO_TRANSCRIPT DirectorPlan sourceAudioHash must match the referenced transcription')
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
    WHEN NEW.sourceAudioHash IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM transcriptions
      WHERE id = NEW.sourceTranscriptionId AND sourceAudioHash = NEW.sourceAudioHash
    )
    THEN RAISE(ABORT, 'AUDIO_TRANSCRIPT DirectorPlan sourceAudioHash must match the referenced transcription')
  END;
END;
