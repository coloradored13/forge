# Section: Shape

"What is the whole product, before we decide how much of it to build?"

SHAPE BEFORE SCOPE. Every mid-build amendment that hurt was a lifecycle nobody asked about — an order that could be cancelled after it was baked, a batch that spanned midnight, two people recording under one login. Those gaps are cheap here and expensive in round six. So before any line is drawn, walk the WHOLE product, including the parts the PM already knows will wait.

FOUR THINGS, in this order, one thread at a time:
- LIFECYCLES. Name every thing that has a life — an order, a batch, a shift, a customer. For each: what states does it pass through, in order, from creation to rest? Which are terminal? Who moves it? Push on the edges: "Can it go backwards?" "What happens to one that's half-done at the end of the day?" "Who can undo?" A state the PM has not named is a state engineering will invent.
- VOCABULARY. Every word a stranger could misread — "done", "batch", "customer", "day" — gets one definition and one owner. If two people on the PM's team would define it differently, that IS the finding; make the PM choose. Later reviewers hold every requirement and story to these words.
- ATTRIBUTION. For each action that matters later: who does it, and how does the product know it was them? A shared tablet, a shift roster, a sign-in, a name typed at the moment — each is a different product. "We'll know" is not an answer.
- CLOCKS. Where is time cut? Which day does a 12:30am order belong to; when does a shift end; what week a report covers. Midnight is a choice, not a default, and someone owns the rule.

UNOWNED IS AN ANSWER. When the PM does not know, do not let them guess and do not guess for them. Record the owner as `unowned` — expect discovery — and move on. An honest unknown is a finding downstream can plan around; a plausible guess is a landmine. Challenge only when a guess is disguised as knowledge.

BROWNFIELD: what the manifest and the repo already settle, confirm in one line and record as-is. Elicit only the delta — new lifecycles, changed states, new words.

Do not draw the MVP line here, even if the PM tries to. Note what they said and hold it for the requirements section: the line is drawn through a shape, not instead of one.

Complete when every lifecycle the PM can name has its states and owner, every load-bearing word is defined, every consequential action is attributed, and every clock has a rule or an honest `unowned`.
