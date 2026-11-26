# Qualification test set

`qualify-testset-template.csv` is the format for the Quality Lab's qualification test (/admin/lab).
The three rows are placeholders showing the format; replace them with about 50 real companies you
labelled yourself.

| Column | What to put in |
| --- | --- |
| `domain` | The company's website, e.g. `bakkerijvos.nl` |
| `company` | The company name (optional) |
| `title` | The contact's job title (optional) |
| `target_customer` | Who fits, then `Not:` and who doesn't, e.g. `Independent bakeries in the Netherlands. Not: chains, wholesalers` |
| `should_fit` | `yes` or `no`: your own judgement, before the test |

Aim for a mix: roughly half `yes` and half `no`, and a few hard cases (a bakery that also sells
wholesale, an agency of two people). The report shows accuracy, the false no_fit rate (good leads
the check would skip) and the cost per lead. The test spends real money with a real AI provider, so
it only starts after the spend is approved on /admin/lab.
