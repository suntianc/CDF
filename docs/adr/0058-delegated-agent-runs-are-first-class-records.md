# Delegated Agent Runs are first-class records

## Status

Accepted

Every child execution receives one durable Delegated Agent Run identity regardless of whether it was launched through single or parallel delegation. The record relates the parent Agent Run, target Agent, launch form, optional parallel batch, optional Workflow Run Task, status, timing, and outcome; tool activity and approvals refer to this identity instead of inferring ownership from task call IDs or worker IDs. Persisting execution history does not make the live child graph durable: unfinished records are reconciled as interrupted after process loss, consistent with ADR-0057.
