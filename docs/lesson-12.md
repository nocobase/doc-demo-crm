# Scheduled sales activity reports

Start the CRM with `pnpm dev` after installing its dependencies and configuring the application. Startup applies the daily report migration and registers **Daily sales activity**. The CRM sales manager role can open **Sales activity reports**. An administrator can also see upcoming runs and execution history under **System settings → Schedules**.

The schedule fires at 01:00 in `Asia/Shanghai`. The [report provider](../server/providers/daily-reports.ts) counts customers, opportunities and follow-ups created during the previous local calendar day. Both local midnights are converted to UTC for the query. The report includes the first midnight and excludes the second. A repeat run updates the row for that date. Change `reportTimezone` to use another team time zone.

Run the [boundary test](../tests/server/daily-reports.test.ts) from the project root:

```sh
pnpm exec vitest run tests/server/daily-reports.test.ts
```

The test creates a customer at midnight on November 25, an opportunity at midnight on November 26 and follow-ups at 23:55 and 00:05 Shanghai time. At 01:00 on November 26, the November 25 report has one new customer, zero new opportunities and one follow-up. In the application, compare the result in the schedule’s run history with the row in **Sales activity reports**.
