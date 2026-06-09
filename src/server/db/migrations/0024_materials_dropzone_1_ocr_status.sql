-- =============================================================================
-- MATERIALS-DROPZONE-1 Increment B — OCR extraction status values
-- =============================================================================
-- ADDITIVE ONLY. Appends two values to the matter_materials.extractionStatus ENUM so the
-- async image/scanned-PDF OCR path (tesseract.js + @hyzyla/pdfium, in-process, no egress)
-- can record its lifecycle:
--   'processing'     — OCR is queued/running (set at upload; cleared when OCR finishes).
--   'low_confidence' — OCR completed but fell below the confidence floor; the text is shown
--                      to the user but is EXCLUDED from the assessment context (honesty floor).
--
-- ENUM value ADDITION is additive: MODIFY re-declares the column with the SAME existing values
-- IN ORDER plus the two new trailing values — no value is removed or reordered, existing rows
-- stay valid, and a re-run to the identical definition is a no-op (idempotent). The pre-deploy
-- additive guard permits ALTER ... MODIFY (it is not DROP/TRUNCATE/DELETE/RENAME/UPDATE).
-- -----------------------------------------------------------------------------

ALTER TABLE `matter_materials`
  MODIFY COLUMN `extractionStatus` ENUM(
    'extracted',
    'partial',
    'failed',
    'not_supported',
    'processing',
    'low_confidence'
  ) NOT NULL;
