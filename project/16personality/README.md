# Two Sides — Visual 16-Personality Quiz

Two Sides is a static HTML, CSS, and TypeScript personality quiz. It presents 32 illustrated cards, one at a time. Every card contains two scenes representing opposite personality preferences. The user swipes toward the scene that feels more like them.

The result is a four-letter code such as `INFP` or `ESTJ`. Combining four dimensions produces 16 possible character types.

## How to answer

- Swipe or drag left to select the left scene.
- Swipe or drag right to select the right scene.
- You can also tap either half, use the buttons, or press the arrow keys.
- Undo removes the most recent answer.

The original OEJTS instrument uses a five-point scale. This visual adaptation is binary: left is recorded as `1` and right as `5`. Removing neutral and moderate answers makes the experience faster, but may produce stronger preferences than the original questionnaire.

## All 32 questions in words

Every row asks which description feels more like the user. Neither side is intended to be better.

| # | Left scene | Right scene | Dimension |
|---:|---|---|---|
| 1 | I make lists. | I rely on memory. | J/P |
| 2 | I am skeptical and look for evidence. | I am inclined to believe possibilities. | F/T |
| 3 | Too much time alone bores me. | I need time alone to recharge. | I/E |
| 4 | I accept things as they are. | I look for how things could be improved. | S/N |
| 5 | I keep my room and belongings organized. | I put belongings wherever convenient. | J/P |
| 6 | I value a warm, human way of thinking. | I strive for mechanical precision and objectivity. | F/T |
| 7 | I am energetic and active. | I am mellow and relaxed. | I/E |
| 8 | I prefer multiple-choice answers. | I prefer open-ended or essay answers. | S/N |
| 9 | My workflow is flexible and chaotic. | My workflow is orderly and organized. | J/P |
| 10 | Criticism or conflict can hurt me easily. | I am generally thick-skinned. | F/T |
| 11 | I work best with a group. | I work best alone. | I/E |
| 12 | I focus on the present. | I focus on the future. | S/N |
| 13 | I plan far ahead. | I plan near the last minute. | J/P |
| 14 | I want people''s respect. | I want people''s love and affection. | F/T |
| 15 | Parties wear me out. | Parties energize me. | I/E |
| 16 | I naturally fit in. | I naturally stand out. | S/N |
| 17 | I prefer to keep my options open. | I prefer to make a commitment. | J/P |
| 18 | I want to be good at fixing things. | I want to be good at helping people with problems. | F/T |
| 19 | I tend to talk more. | I tend to listen more. | I/E |
| 20 | I explain what happened. | I explain what the event meant. | S/N |
| 21 | I start work right away. | I tend to delay starting work. | J/P |
| 22 | I follow my heart. | I follow my head. | F/T |
| 23 | I prefer staying at home. | I prefer going out. | I/E |
| 24 | I want the big picture. | I want the details. | S/N |
| 25 | I improvise. | I prepare. | J/P |
| 26 | I base morality on justice and consistent rules. | I base morality on compassion and individual circumstances. | F/T |
| 27 | I find it difficult to call out loudly. | Calling loudly to someone far away feels natural. | I/E |
| 28 | I am theoretical. | I am empirical and evidence-focused. | S/N |
| 29 | I work hard. | I play hard. | J/P |
| 30 | I am uncomfortable with emotional expression. | I value emotional expression. | F/T |
| 31 | I like performing or speaking publicly. | I prefer to stay out of the public-speaking spotlight. | I/E |
| 32 | I first ask who, what, and when. | I first ask why. | S/N |

The illustration order does not always match the letter order, so the app uses signed scoring equations rather than simply counting left and right swipes.

## How answers become four letters

| Dimension | First pole | Second pole |
|---|---|---|
| I/E | Introversion: reflection, solitude, focused space | Extraversion: interaction, activity, external energy |
| S/N | Sensing: concrete facts, present experience, details | Intuition: patterns, possibilities, future meaning |
| F/T | Feeling: values, relationships, human impact | Thinking: logic, consistency, objective principles |
| J/P | Judging: structure, decisions, preparation | Perceiving: flexibility, open options, adaptation |

Let `Q1` through `Q32` be the recorded values (`1` for left and `5` for right):

```text
IE = 30 - Q3 - Q7 - Q11 + Q15 - Q19 + Q23 + Q27 - Q31
SN = 12 + Q4 + Q8 + Q12 + Q16 + Q20 - Q24 - Q28 + Q32
FT = 30 - Q2 + Q6 + Q10 - Q14 - Q18 + Q22 - Q26 - Q30
JP = 18 + Q1 + Q5 - Q9 + Q13 - Q17 + Q21 - Q25 + Q29
```

Each score is compared with midpoint `24`:

- `IE > 24` gives E; otherwise I.
- `SN > 24` gives N; otherwise S.
- `FT > 24` gives T; otherwise F.
- `JP > 24` gives P; otherwise J.

Exactly `24` goes to I, S, F, or J. Joining the letters in order creates the type: I/E + S/N + F/T + J/P. For example, I + N + F + P becomes `INFP`.

## How the character is chosen

There is no separate character-selection algorithm. The app assigns a friendly character name to the calculated four-letter combination.

| Code | Character | General theme |
|---|---|---|
| INTJ | The Architect | Independent, strategic, future-oriented planning |
| INTP | The Thinker | Analytical exploration and conceptual problem-solving |
| ENTJ | The Commander | Decisive organization and strategic leadership |
| ENTP | The Explorer | Energetic experimentation and possibility-seeking |
| INFJ | The Advocate | Reflective insight guided by people and values |
| INFP | The Mediator | Imagination, personal values, and open exploration |
| ENFJ | The Guide | Social energy directed toward people and purpose |
| ENFP | The Spark | Enthusiastic connection, imagination, and flexibility |
| ISTJ | The Inspector | Careful observation, reliability, and structure |
| ISFJ | The Protector | Practical attentiveness guided by care for others |
| ESTJ | The Organizer | Concrete action, coordination, and dependable structure |
| ESFJ | The Connector | Practical social care and community coordination |
| ISTP | The Craftsperson | Independent hands-on analysis and adaptation |
| ISFP | The Artist | Quiet observation, values, and flexible expression |
| ESTP | The Dynamo | Immediate action, practical experimentation, and energy |
| ESFP | The Entertainer | Present-focused warmth, activity, and spontaneity |

The result bars convert each raw score to a percentage:

```text
second-pole percentage = ((score - 8) / 32) × 100
```

Preference strength is the distance from the 50% midpoint. It describes this quiz result, not clinical certainty.

## Project structure

```text
16personality/
  assets/             32 cards and attribution
  dist/app.js         compiled browser JavaScript
  src/app.ts          strict TypeScript source
  index.html          entry page
  style.css           responsive styling
  tsconfig.json       TypeScript configuration
```

## Build and run

Run `tsc --noEmit` and then `tsc` from this folder. Open `index.html` directly in a modern browser. The JavaScript is a deferred classic script, so Chrome can run it from a local `file://` URL without a server.

## Source, license, and limitations

Questions and scoring are adapted from *Open Extended Jungian Type Scales 1.2* by Eric Jorgenson:

<https://openpsychometrics.org/tests/OJTS/development/OEJTS1.2.pdf>

OEJTS 1.2 is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). This derivative must be attributed, used noncommercially, and shared under the same license.

This quiz is for self-reflection and entertainment. It is not a diagnosis, clinical assessment, or hiring tool; it is not the official Myers-Briggs Type Indicator; and it is not affiliated with The Myers-Briggs Company.

