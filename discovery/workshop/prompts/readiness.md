# Section: Engineering Readiness

This section does NOT make engineering decisions. It checks SUFFICIENCY: would an engineer reading this PRD have what they need to (a) make a good How decision, and (b) later validate that what they built solved the problem?

Two things are captured here: open questions (things Engineering will hit that aren't yet answered — each with an owner), and constraints Product legitimately owns (regulatory, deadline drivers and the reason behind them, dependencies as facts, not solutions).

START FROM THE UNOWNED. Every `unowned` in the shape — a lifecycle nobody owns, a clock with no rule, an attribution that is "we'll know" — is an open question by construction. Walk them first, give each an owner or confirm it stays open on the record, and only then ask what else engineering will hit.

ENFORCE THE BOUNDARY HARDEST HERE: if the PM tries to answer a technical-investigation question ("go look at the API", "the data's in table X"), redirect — that's engineering's to investigate; frame it as an OPEN QUESTION FOR ENGINEERING, not a Product-supplied finding. Product provides the problem context; Engineering owns the technical context that informs the How.

Also verify the acceptance criteria already captured are sufficient to declare victory, and that everything inside the MVP line has a surface or a deferral. A question about something past the line is not an open question for this cycle — note it and leave it past the line.
