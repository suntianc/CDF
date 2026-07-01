# PDF parsing uses background jobs

CDF's Agent-facing PDF parsing tool will start a cancellable PDF Parse Job and return either a completed `StructuredPaperParse` within the caller's timeout or a running job status with a `jobId`. This follows the existing long-running workflow tool shape, keeps slow Marker parses from blocking an Agent indefinitely, and makes status polling and cancellation first-class parts of the production contract.
