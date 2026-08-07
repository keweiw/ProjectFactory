# Visual OEJTS Question Cards

This folder contains 32 paired-panel illustrations for the 32 items in the Open Extended Jungian Type Scales (OEJTS) 1.2. Each PNG is 1774 x 887 pixels (2:1), with the left image representing response value `1` and the right image representing response value `5`. Values `2` through `4` express positions between those poles.

## Card map

| File | Left pole | Right pole | Scale |
|---|---|---|---|
| `question-01.png` | makes lists | relies on memory | J/P |
| `question-02.png` | sceptical | wants to believe | F/T |
| `question-03.png` | bored by time alone | needs time alone | I/E |
| `question-04.png` | accepts things as they are | dissatisfied with how things are | S/N |
| `question-05.png` | keeps a clean room | puts things wherever convenient | J/P |
| `question-06.png` | sees “robotic” as an insult | strives for a mechanical mind | F/T |
| `question-07.png` | energetic | mellow | I/E |
| `question-08.png` | prefers multiple choice | prefers essay answers | S/N |
| `question-09.png` | chaotic | organized | J/P |
| `question-10.png` | easily hurt | thick-skinned | F/T |
| `question-11.png` | works best in groups | works best alone | I/E |
| `question-12.png` | focused on the present | focused on the future | S/N |
| `question-13.png` | plans far ahead | plans at the last minute | J/P |
| `question-14.png` | wants respect | wants love | F/T |
| `question-15.png` | worn out by parties | energized by parties | I/E |
| `question-16.png` | fits in | stands out | S/N |
| `question-17.png` | keeps options open | commits | J/P |
| `question-18.png` | wants to fix things | wants to help people | F/T |
| `question-19.png` | talks more | listens more | I/E |
| `question-20.png` | describes what happened | describes what it meant | S/N |
| `question-21.png` | starts work right away | procrastinates | J/P |
| `question-22.png` | follows the heart | follows the head | F/T |
| `question-23.png` | stays at home | goes out | I/E |
| `question-24.png` | wants the big picture | wants the details | S/N |
| `question-25.png` | improvises | prepares | J/P |
| `question-26.png` | bases morality on justice | bases morality on compassion | F/T |
| `question-27.png` | finds yelling loudly difficult | calls loudly with ease | I/E |
| `question-28.png` | theoretical | empirical | S/N |
| `question-29.png` | works hard | plays hard | J/P |
| `question-30.png` | uncomfortable with emotions | values emotions | F/T |
| `question-31.png` | likes performing publicly | avoids public speaking | I/E |
| `question-32.png` | asks who/what/when | asks why | S/N |

## Original scoring

For answers `Q1` through `Q32`, each valued from 1 to 5:

```text
IE = 30 - Q3 - Q7 - Q11 + Q15 - Q19 + Q23 + Q27 - Q31
SN = 12 + Q4 + Q8 + Q12 + Q16 + Q20 - Q24 - Q28 + Q32
FT = 30 - Q2 + Q6 + Q10 - Q14 - Q18 + Q22 - Q26 - Q30
JP = 18 + Q1 + Q5 - Q9 + Q13 - Q17 + Q21 - Q25 + Q29
```

- `IE > 24` gives E; otherwise I.
- `SN > 24` gives N; otherwise S.
- `FT > 24` gives T; otherwise F.
- `JP > 24` gives P; otherwise J.

## Visual system

The cards use one recurring character, two equally weighted square panels, a warm flat-editorial palette, rounded framing, and no embedded words. Each pole is intentionally shown as a valid preference rather than a success/failure comparison.

Base generation prompt: modern flat editorial cartoon; cream background; muted teal, coral, mustard, and soft navy; gentle paper texture; exact 2:1 paired-panel composition; same character in both panels; equal visual weight; no text, logos, watermark, failure cues, photorealism, 3D, or moral judgment. The images were produced with the built-in OpenAI image-generation tool.

## Source and license

The item wording and scoring method are adapted from *Open Extended Jungian Type Scales 1.2* by Eric Jorgenson, hosted by the Open-Source Psychometrics Project:

<https://openpsychometrics.org/tests/OJTS/development/OEJTS1.2.pdf>

OEJTS 1.2 is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). This derivative set must be attributed, used noncommercially, and shared under the same license. The instrument is not the Myers-Briggs Type Indicator and is not affiliated with The Myers-Briggs Company. It is intended for self-reflection/entertainment, not diagnosis, hiring, or other high-stakes decisions.
