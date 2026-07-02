# PDF recovery reruns reuse the baseline parse

When a user changes the PDF Recovery Route or retries failed recovery work, CDF should rerun recovery against the existing PDF Parse Artifact and baseline Marker result rather than rerunning Marker by default. Recovery route changes affect recovery overlays, recovered views, diagnostics, and provenance; they do not imply a fresh baseline parse.

Marker baseline parsing can be slow and should only be rerun when the user explicitly requests a full reparse, the source PDF changed, or the existing artifact is invalid or missing required baseline evidence.
