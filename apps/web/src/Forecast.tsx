import { Panel, Table, Notice, Metric } from './components';
import { money, date } from './api';
export default function Forecast({
  value: f,
  format = money,
}: {
  value: any;
  format?: (v: string) => string;
}) {
  if (!f) return null;
  return (
    <Panel
      title={'What this means over ' + f.horizonDays + ' days'}
      subtitle={date(f.from) + ' to ' + date(f.until)}
    >
      {f.kind === 'company' ? (
        <>
          <div className="preview-values">
            <Metric label="Current agreement forecast" value={format(f.current)} />
            <Metric label="Proposed agreement forecast" value={format(f.proposed)} />
            <Metric label="Additional funding needed" value={format(f.shortfall)} />
          </div>
          <p className="panel-padding">
            {f.signedCount} signed paydays total {format(f.signedAmount)}. The rest is a
            continuation scenario.
          </p>
          <Table headers={['Calendar month', 'Current', 'Proposed', 'Paydays']}>
            {f.periods.map((p: any) => (
              <tr key={p.period}>
                <td>{p.period}</td>
                <td>{format(p.current)}</td>
                <td>{format(p.proposed)}</td>
                <td>{p.count}</td>
              </tr>
            ))}
          </Table>
        </>
      ) : (
        <>
          <div className="preview-values">
            {f.baseline ? (
              <Metric
                label="Current rule: projected cash"
                value={format(f.baseline.projectedCash)}
              />
            ) : null}
            <Metric label="Proposed rule: projected cash" value={format(f.projectedCash)} />
            <Metric label="Assumed salary receipts" value={String(f.paydays)} />
            <Metric label="DCA budget remaining" value={format(f.remainingDcaBudget)} />
          </div>
          <Table headers={['Savings goal', 'Projected savings', 'Estimated completion']}>
            {f.goals.map((g: any) => (
              <tr key={g.id}>
                <td>
                  {g.name}
                  {g.targetDate ? (
                    <small>
                      Target {date(g.targetDate)} ·{' '}
                      {g.targetDateMet ? 'Projected within target' : 'Not projected by target date'}
                    </small>
                  ) : null}
                </td>
                <td>
                  {format(g.funded)} / {format(g.target)}
                </td>
                <td>
                  {g.completion
                    ? g.completion.paydays + ' salary receipts / ' + date(g.completion.at)
                    : g.state === 'COMPLETED'
                      ? 'Already completed'
                      : 'Beyond this horizon'}
                </td>
              </tr>
            ))}
          </Table>
          {f.dca.length ? (
            <Table headers={['DCA plan', 'Affordable purchases', 'Skipped occurrences']}>
              {f.dca.map((p: any) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.fundedOccurrences}</td>
                  <td>{p.skippedOccurrences}</td>
                </tr>
              ))}
            </Table>
          ) : null}
        </>
      )}
      <Notice>
        <b>Assumptions</b>
        <ul>
          {f.assumptions.map((a: string) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </Notice>
    </Panel>
  );
}
