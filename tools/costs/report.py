"""Summarize an explicit USD project cost manifest without double-counting reservations."""
import argparse
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path


def money(value):
    if isinstance(value, bool):
        raise ValueError('Boolean is not a monetary amount')
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ValueError('Invalid amount') from None
    if not number.is_finite() or number < 0:
        raise ValueError('Amounts must be finite and nonnegative')
    return number


def summarize(data):
    if data.get('schemaVersion') != 1 or data.get('currency') != 'USD':
        raise ValueError('Expected schemaVersion 1 and USD; normalize FX explicitly first')
    if data.get('coverage') not in ('complete', 'partial'):
        raise ValueError('coverage must be complete or partial')
    if not isinstance(data.get('project'), str) or not data['project'].strip():
        raise ValueError('project is required')
    entries = data.get('entries')
    if not isinstance(entries, list):
        raise ValueError('entries must be a list')
    totals = {k: Decimal(0) for k in ['actual', 'estimated', 'planned', 'reserved']}
    categories, seen, unknown, rows = {}, set(), [], []
    for entry in entries:
        identity = (entry.get('provider'), entry.get('id'))
        if not all(isinstance(x,str) and x.strip() for x in identity) or identity in seen:
            raise ValueError('Each provider/id must be nonempty and unique; do not add snapshots twice')
        seen.add(identity)
        if not isinstance(entry.get('category'), str) or not entry['category'].strip():
            raise ValueError('category is required')
        if not isinstance(entry.get('source'), str) or not entry['source'].strip():
            raise ValueError('Every entry needs source evidence or an explicit missing-evidence note')
        phase = entry.get('phase', 'incurred')
        if phase not in ('incurred', 'planned'):
            raise ValueError('Invalid phase')
        actual = money(entry['actualUSD']) if entry.get('actualUSD') is not None else None
        estimated = money(entry['estimatedUSD']) if entry.get('estimatedUSD') is not None else None
        reserved = money(entry['reservedUSD']) if entry.get('reservedUSD') is not None else Decimal(0)
        if actual is not None and not entry.get('billingEvidence'):
            raise ValueError('actualUSD requires billingEvidence; usage math is an estimate')
        if phase == 'planned' and actual is not None:
            raise ValueError('Planned work cannot have actual charges')
        if estimated is None and entry.get('quantity') is not None:
            estimated = money(entry['quantity']) * money(entry['unitRateUSD'])
            if not entry.get('unit') or not entry.get('rateSource') or not entry.get('rateDate'):
                raise ValueError('Quantity estimates need unit, rateSource and rateDate')
        bucket = categories.setdefault(entry['category'], {k: Decimal(0) for k in totals})
        amount = actual if actual is not None else estimated
        kind = 'planned' if phase == 'planned' else ('actual' if actual is not None else 'estimated')
        if amount is None:
            unknown.append({'provider':identity[0], 'id':identity[1], 'phase':phase, 'source':entry['source']})
        else:
            totals[kind] += amount; bucket[kind] += amount
        totals['reserved'] += reserved; bucket['reserved'] += reserved
        rows.append({'provider':identity[0], 'id':identity[1], 'category':entry['category'],
                     'phase':phase, 'basis':kind if amount is not None else 'unknown',
                     'amountUSD':float(amount) if amount is not None else None, 'source':entry['source']})
    known = totals['actual'] + totals['estimated']
    all_billed = data['coverage'] == 'complete' and all(r['basis'] == 'actual' for r in rows if r['phase']=='incurred')
    has_unknown_incurred = any(e['phase']=='incurred' for e in unknown)
    budget = money(data['budgetUSD']) if data.get('budgetUSD') is not None else None
    return {'schemaVersion':1, 'project':data['project'], 'currency':'USD', 'coverage':data['coverage'],
            'actualKnownUSD':float(totals['actual']), 'usageEstimateUSD':float(totals['estimated']),
            'knownIncurredSubtotalUSD':float(known),
            'actualTotalUSD':float(totals['actual']) if all_billed else None,
            'estimatedIncurredTotalUSD':float(known) if data['coverage']=='complete' and not has_unknown_incurred else None,
            'plannedKnownUSD':float(totals['planned']),
            'knownForecastSubtotalUSD':float(known+totals['planned']),
            'reservationReferenceUSD':float(totals['reserved']),
            'budgetUSD':float(budget) if budget is not None else None,
            'budgetLessKnownForecastUSD':float(budget-known-totals['planned']) if budget is not None else None,
            'unknownEntries':unknown, 'categories':{k:{a:float(b) for a,b in v.items()} for k,v in categories.items()},
            'entries':rows,
            'notes':['Reservations are shown separately, never added to usage costs.',
                     'Budget minus known forecast is not guaranteed available budget when coverage is partial or costs are unknown.',
                     'Account deposits and balances are not project expense. No live billing was fetched.']}


def markdown(report):
    lines = [f"# {report['project']} 开支估算", '',
             f"已确认费用：${report['actualKnownUSD']:.4f}",
             f"未对账的用量估算：${report['usageEstimateUSD']:.4f}",
             f"已发生费用的已知小计：**${report['knownIncurredSubtotalUSD']:.4f}**", '',
             '实际账单总额：' + (f"${report['actualTotalUSD']:.4f}" if report['actualTotalUSD'] is not None else '未知／未完成对账'),
             f"覆盖范围：{report['coverage']}；未知项目：{len(report['unknownEntries'])}", '',
             '| 类别 | 已确认 USD | 用量估算 USD | 后续计划 USD | 预留参考 USD |',
             '| --- | ---: | ---: | ---: | ---: |']
    for name, v in report['categories'].items():
        lines.append('| '+name.replace('|','/')+' | '+' | '.join(f'{v[k]:.4f}' for k in ['actual','estimated','planned','reserved'])+' |')
    lines += ['', f"后续计划已知估算：${report['plannedKnownUSD']:.4f}",
              f"已发生＋后续计划的已知小计：${report['knownForecastSubtotalUSD']:.4f}"]
    if report['budgetUSD'] is not None:
        lines += [f"预算：${report['budgetUSD']:.4f}；减去已知预测：${report['budgetLessKnownForecastUSD']:.4f}（不代表可保证剩余额度）。"]
    lines += ['', '预留不再计入小计。充值和余额不算项目消费。部分覆盖或存在未知费用时，不能把小计称作项目总成本。', '', '## 费用依据', '']
    for e in report['entries']:
        amount = '未知' if e['amountUSD'] is None else f"${e['amountUSD']:.6f}"
        lines.append(f"- {e['provider']}/{e['id']}：{amount}，{e['basis']}；来源：{e['source']}")
    return '\n'.join(lines)+'\n'


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args()
    result=summarize(json.loads(a.manifest.read_text()))
    a.out.mkdir(parents=True,exist_ok=False)
    (a.out/'cost-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    (a.out/'COSTS.md').write_text(markdown(result))
    print(json.dumps({k:result[k] for k in ['project','knownIncurredSubtotalUSD','actualTotalUSD','plannedKnownUSD']},ensure_ascii=False))

if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,TypeError,OSError) as e:
        raise SystemExit(str(e))
