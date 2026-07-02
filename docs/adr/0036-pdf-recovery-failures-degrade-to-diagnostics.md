# PDF recovery failures degrade to diagnostics

Issue #61 recovery is an enhancement path over the Marker baseline. If the baseline parse succeeds and one or more recovery actions fail, the overall parse should return the best available Recovered Paper Parse View with diagnostics rather than failing the entire PDF parse.

Failed recovery pages or blocks keep the baseline parse result, record recovery diagnostics and minimal provenance, and surface clear retry options such as changing the PDF Recovery Route or rerunning recovery. The parse should only fail outright when no usable baseline or recovered result can be produced.
