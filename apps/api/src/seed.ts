import { Store, acct } from '../../../packages/db/src/index.js';
export const assets = [
  {
    id: 'BTC',
    name: 'Bitcoin',
    network: 'Bitcoin',
    price: '6800000',
    color: '#c9853e',
    category: 'Crypto',
  },
  {
    id: 'ETH',
    name: 'Ethereum',
    network: 'Ethereum',
    price: '340000',
    color: '#7896b4',
    category: 'Crypto',
  },
  { id: 'NEAR', name: 'NEAR', network: 'NEAR', price: '480', color: '#213f52', category: 'Crypto' },
  {
    id: 'SOL',
    name: 'Solana',
    network: 'Solana',
    price: '18000',
    color: '#6a9395',
    category: 'Crypto',
  },
  {
    id: 'PAXG',
    name: 'Tokenized gold',
    network: 'Ethereum',
    price: '270000',
    color: '#b29850',
    category: 'Commodity',
  },
  {
    id: 'AAPL',
    name: 'Apple stock scenario',
    network: 'Simulation only',
    price: '22500',
    color: '#889398',
    category: 'Stock',
  },
  {
    id: 'SPY',
    name: 'S&P 500 ETF scenario',
    network: 'Simulation only',
    price: '61000',
    color: '#496c8c',
    category: 'ETF',
  },
];
export function seed(s: Store) {
  if (!s.get('new-employee'))
    s.save({
      id: 'new-employee',
      type: 'user',
      name: 'New team member',
      role: 'employee',
      demo: true,
    });
  const legacyOperator = s.get('admin');
  if (legacyOperator?.demo && legacyOperator.name === 'Noma operator')
    s.atomic(() => s.save({ ...legacyOperator, name: 'numa operator' }));
  if (s.get('seed-v1')) return;
  s.atomic(() => {
    for (const u of [
      { id: 'owner', name: 'Alex Morgan', role: 'owner', email: 'alex@forma.example' },
      { id: 'maya', name: 'Maya Chen', role: 'employee', email: 'maya@forma.example' },
      { id: 'accountant', name: 'Sam Taylor', role: 'accountant', email: 'sam@forma.example' },
      { id: 'observer', name: 'Jamie Ross', role: 'observer', email: 'jamie@forma.example' },
      { id: 'admin', name: 'numa operator', role: 'admin', email: 'operator@numa.example' },
      { id: 'other-owner', name: 'River Bennett', role: 'owner', email: 'river@orbit.example' },
    ])
      s.save({ type: 'user', ...u, demo: true });
    s.save({
      id: 'forma',
      type: 'company',
      owner: 'owner',
      tenant: 'forma',
      name: 'Forma Studio',
      timezone: 'Europe/London',
      status: 'ACTIVE',
      unit: 'demoUSD',
      mode: 'SIMULATION',
    });
    s.save({
      id: 'orbit',
      type: 'company',
      owner: 'other-owner',
      tenant: 'orbit',
      name: 'Orbit Labs',
      timezone: 'UTC',
      status: 'ACTIVE',
      unit: 'demoUSD',
      mode: 'SIMULATION',
    });
    for (const [uid, access] of [
      ['owner', 'owner'],
      ['accountant', 'accountant'],
      ['observer', 'observer'],
      ['maya', 'employee'],
    ])
      s.save({ type: 'membership', tenant: 'forma', owner: uid, access, status: 'ACTIVE' });
    s.save({
      type: 'membership',
      tenant: 'orbit',
      owner: 'other-owner',
      access: 'owner',
      status: 'ACTIVE',
    });
    for (const r of [
      { id: 'design', name: 'Design', salary: '480000' },
      { id: 'engineering', name: 'Engineering', salary: '620000' },
      { id: 'operations', name: 'Operations', salary: '380000' },
    ])
      s.save({ type: 'role', tenant: 'forma', owner: 'owner', cadence: 'monthly', ...r });
    const now = new Date();
    const anchor = new Date(now.getTime() + 86400000).toISOString();
    const people = [
      {
        id: 'emp-maya',
        owner: 'maya',
        name: 'Maya Chen',
        roleId: 'design',
        salary: '480000',
        cadence: 'monthly',
      },
      {
        id: 'emp-noah',
        owner: 'noah',
        name: 'Noah Williams',
        roleId: 'engineering',
        salary: '620000',
        cadence: 'monthly',
      },
      {
        id: 'emp-lena',
        owner: 'lena',
        name: 'Lena Ortiz',
        roleId: 'engineering',
        salary: '145000',
        cadence: 'weekly',
      },
      {
        id: 'emp-eli',
        owner: 'eli',
        name: 'Eli Brooks',
        roleId: 'operations',
        salary: '18000',
        cadence: 'daily',
      },
      {
        id: 'emp-amara',
        owner: 'amara',
        name: 'Amara Okafor',
        roleId: 'design',
        salary: '440000',
        cadence: 'monthly',
      },
    ];
    for (const p of people) {
      if (!s.get(p.owner))
        s.save({ id: p.owner, type: 'user', name: p.name, role: 'employee', demo: true });
      s.save({
        type: 'employee',
        tenant: 'forma',
        ...p,
        email: p.owner + '@forma.example',
        status: 'ACTIVE',
        accountId: p.owner + '-noma-demo.testnet',
        identityVerified: false,
        demoIdentity: true,
        scheduleId: 'schedule-' + p.id,
        anchor,
      });
    }
    s.save({
      id: 'maya-policy',
      type: 'policy',
      tenant: 'forma',
      owner: 'maya',
      cashFloor: '220000',
      legs: [
        { id: 'cash', type: 'cash', bps: 6000 },
        { id: 'goals', type: 'goals', bps: 2000 },
        { id: 'dca', type: 'dca', bps: 1500 },
        { id: 'invest', type: 'invest', bps: 5000 - 4500, asset: 'NEAR' },
      ],
    });
    s.save({
      id: 'goal-reserve',
      type: 'goal',
      tenant: 'forma',
      owner: 'maya',
      name: 'A little breathing room',
      target: '1500000',
      funded: '0',
      priority: 1,
      state: 'ACTIVE',
    });
    s.save({
      id: 'goal-japan',
      type: 'goal',
      tenant: 'forma',
      owner: 'maya',
      name: 'Two weeks in Japan',
      target: '400000',
      funded: '0',
      priority: 2,
      state: 'ACTIVE',
    });
    s.transfer(
      'demoUSD',
      'forma',
      'seed-funding',
      'FUND',
      'Sample treasury funding',
      acct('external'),
      acct('forma'),
      '7500000',
      true,
    );
    s.transfer(
      'demoUSD',
      'forma',
      'seed-bonus',
      'FUND',
      'Sample bonus reserve funding',
      acct('external'),
      acct('forma', 'bonus'),
      '100000',
      true,
    );
    s.transfer(
      'demoUSD',
      'forma',
      'seed-salary',
      'SALARY',
      'Sample salary fixture, not an on-chain payment',
      acct('forma'),
      acct('maya'),
      '480000',
    );
    s.transfer(
      'demoUSD',
      'forma',
      'seed-goal',
      'RESERVE',
      'Sample goal allocation',
      acct('maya'),
      acct('maya', 'goal:goal-reserve'),
      '96000',
    );
    const g = s.get('goal-reserve')!;
    s.save({ ...g, funded: '96000' });
    s.transfer(
      'demoUSD',
      'forma',
      'seed-dca',
      'RESERVE',
      'Sample DCA allocation',
      acct('maya'),
      acct('maya', 'dca'),
      '72000',
    );
    s.save({
      type: 'money-plan',
      id: 'maya-money-plan',
      owner: 'maya',
      tenant: 'forma',
      expenses: '210000',
      outsideSavings: '150000',
      monthlyIncome: '480000',
      repayment: '0',
    });
    s.save({
      id: 'settings',
      type: 'settings',
      owner: 'admin',
      maxEmployees: 50,
      maintenance: false,
      network: 'testnet',
    });
    s.save({
      type: 'notification',
      owner: 'maya',
      tenant: 'forma',
      title: 'Your salary has a plan',
      body: 'The sample salary has been split into cash, savings and a DCA budget.',
      read: false,
    });
    s.save({
      type: 'notification',
      owner: 'owner',
      tenant: 'forma',
      title: 'Ready for the next payday',
      body: 'Fund and authorize a payroll window to start automation.',
      read: false,
    });
    s.save({ id: 'seed-v1', type: 'meta', label: 'Demonstration fixtures, not live transactions' });
  });
}
