use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{U64, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{IterableMap, IterableSet, LookupMap, Vector};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, env, ext_contract, near, require,
};
use std::collections::BTreeMap;

const DAY: u64 = 86_400_000_000_000;
const MAX_PENDING_WITHDRAWALS: u32 = 2000;
const MAX_POLICIES: u32 = 1500;
// Upper bound for the resolution event, JSON details (including a colliding
// obligation ID), receipt status growth, and trie key/record overhead. All
// user-controlled IDs are <=100 bytes and account IDs <=64 bytes.
const CALLBACK_STORAGE_BYTES: u64 = 8192;
const V3_MARKER: &[u8] = b"numa:v3:initialized";
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Company {
    pub owner: AccountId,
    pub free: U128,
    pub reserved: U128,
    pub version: u32,
}
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Employee {
    pub company_id: String,
    pub employee_id: String,
    pub account_id: AccountId,
    pub accepted: bool,
}
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Obligation {
    pub id: String,
    pub company_id: String,
    pub employee_id: String,
    pub account_id: AccountId,
    pub amount: U128,
    pub due_at: U64,
    pub execution_not_after: U64,
    pub credited: bool,
    pub paused: bool,
    pub cancelled: bool,
    pub version: u32,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ObligationInput {
    pub id: String,
    pub employee_id: String,
    pub amount: U128,
    pub due_at: U64,
}
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Goal {
    pub id: String,
    pub target: U128,
    pub funded: U128,
    pub priority: u8,
    pub paused: bool,
    pub completed: bool,
    pub released: bool,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct GoalRule {
    pub id: String,
    pub contribution_mode: String,
    pub contribution_value: U128,
    pub percent_basis: String,
    pub overflow: String,
    pub target_date: Option<String>,
    pub state: String,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct GoalInputV2 {
    pub id: String,
    pub target: U128,
    pub priority: u8,
    pub rule: GoalRule,
    pub confirm_changes: bool,
}
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Default)]
#[serde(crate = "near_sdk::serde")]
pub struct GoalPolicy {
    pub goals: Vec<Goal>,
    pub goal_bps: u16,
    pub cash_floor: U128,
    pub version: u32,
}
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Withdrawal {
    pub account_id: AccountId,
    pub amount: U128,
    pub state: String,
    pub company_id: Option<String>,
}
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Event {
    pub event_sequence: U64,
    pub event_type: String,
    pub reference: String,
    pub account_id: AccountId,
    pub amount: U128,
}
#[allow(dead_code)]
#[ext_contract(ext_self)]
trait Callbacks {
    fn on_withdraw_result(&mut self, operation_id: String) -> bool;
}
// Exact deployed V2 Borsh field order and types. Never add fields here.
#[derive(BorshSerialize, BorshDeserialize)]
struct ContractV2 {
    executor: AccountId,
    companies: BTreeMap<String, Company>,
    employees: BTreeMap<String, Employee>,
    obligations: BTreeMap<String, Obligation>,
    cash: BTreeMap<AccountId, u128>,
    policies: BTreeMap<AccountId, GoalPolicy>,
    withdrawals: BTreeMap<String, Withdrawal>,
    operations: BTreeMap<String, Vec<u8>>,
    events: Vec<Event>,
    total_liability: u128,
    pending_transfers: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    storage_version: u32,
    executor: AccountId,
    companies: IterableMap<String, Company>,
    employees: IterableMap<String, Employee>,
    obligations: IterableMap<String, Obligation>,
    cash: IterableMap<AccountId, u128>,
    policies: IterableMap<AccountId, GoalPolicy>,
    withdrawals: LookupMap<String, Withdrawal>,
    operations: LookupMap<String, Vec<u8>>,
    events: Vector<Event>,
    total_liability: u128,
    pending_transfers: u128,
    withdrawal_count: u64,
    // Only unresolved IDs are scanned; archival receipts remain lookup-only.
    pending_withdrawals: IterableSet<String>,
}
#[near]
impl Contract {
    #[init]
    pub fn new(executor: AccountId) -> Self {
        env::storage_write(V3_MARKER, &[3]);
        Self {
            storage_version: 3,
            executor,
            companies: IterableMap::new(b"numa:v3:companies".as_slice()),
            employees: IterableMap::new(b"numa:v3:employees".as_slice()),
            obligations: IterableMap::new(b"numa:v3:obligations".as_slice()),
            cash: IterableMap::new(b"numa:v3:cash".as_slice()),
            policies: IterableMap::new(b"numa:v3:policies".as_slice()),
            withdrawals: LookupMap::new(b"numa:v3:w".as_slice()),
            operations: LookupMap::new(b"numa:v3:o".as_slice()),
            events: Vector::new(b"numa:v3:e".as_slice()),
            total_liability: 0,
            pending_transfers: 0,
            withdrawal_count: 0,
            pending_withdrawals: IterableSet::new(b"numa:v3:pending".as_slice()),
        }
    }
    /// Deploy and call this in one atomic action batch from the contract account.
    /// The account must have enough unencumbered balance for the new trie records
    /// and callback reserves, and the entire V2 snapshot must fit one receipt.
    #[init(ignore_state)]
    #[private]
    pub fn migrate_from_v2() -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "PRIVATE_MIGRATION"
        );
        require!(!env::storage_has_key(V3_MARKER), "ALREADY_MIGRATED");
        let old: ContractV2 = env::state_read().expect("V2_STATE_REQUIRED");
        let mut current = Self::new(old.executor);
        current.companies.extend(old.companies);
        current.employees.extend(old.employees);
        current.obligations.extend(old.obligations);
        current.cash.extend(old.cash);
        current.policies.extend(old.policies);
        current.total_liability = old.total_liability;
        current.pending_transfers = old.pending_transfers;
        current.withdrawal_count = old.withdrawals.len() as u64;
        let mut pending_total = 0u128;
        for (id, withdrawal) in old.withdrawals {
            require!(
                ["PENDING", "SUCCEEDED", "FAILED"].contains(&withdrawal.state.as_str()),
                "INVALID_V2_WITHDRAWAL"
            );
            if withdrawal.state == "PENDING" {
                pending_total = pending_total
                    .checked_add(withdrawal.amount.0)
                    .expect("OVERFLOW");
                current.pending_withdrawals.insert(id.clone());
            }
            current.withdrawals.insert(id, withdrawal);
        }
        require!(
            current.pending_withdrawals.len() <= MAX_PENDING_WITHDRAWALS
                && pending_total == current.pending_transfers,
            "INVALID_V2_PENDING"
        );
        for (key, value) in old.operations {
            current.operations.insert(key, value);
        }
        for (index, event) in old.events.into_iter().enumerate() {
            require!(
                event.event_sequence.0 == index as u64 + 1,
                "INVALID_V2_EVENT_SEQUENCE"
            );
            current.events.push(event);
        }
        current.backing();
        current
    }
    pub fn register_company(&mut self, company_id: String, operation_id: String) {
        Self::id(&company_id);
        Self::id(&operation_id);
        let owner = env::predecessor_account_id();
        let payload = env::sha256(
            near_sdk::serde_json::to_vec(&(&company_id, &owner))
                .unwrap()
                .as_slice(),
        );
        let opkey = format!("register:{}:{}", owner, operation_id);
        if let Some(previous) = self.operations.get(&opkey) {
            require!(*previous == payload, "OPERATION_CONFLICT");
            return;
        }
        require!(self.companies.len() < 30, "COMPANY_LIMIT");
        require!(!self.companies.contains_key(&company_id), "COMPANY_EXISTS");
        self.companies.insert(
            company_id.clone(),
            Company {
                owner: owner.clone(),
                free: U128(0),
                reserved: U128(0),
                version: 1,
            },
        );
        self.operations.insert(opkey, payload);
        self.emit("CompanyRegistered", &company_id, owner, 0);
        self.backing();
    }
    pub fn register_employee(
        &mut self,
        company_id: String,
        employee_id: String,
        account_id: AccountId,
    ) {
        self.owner(&company_id);
        Self::id(&employee_id);
        let k = Self::employee_key(&company_id, &employee_id);
        if let Some(e) = self.employees.get(&k) {
            require!(e.account_id == account_id, "EMPLOYEE_CONFLICT");
            return;
        }
        require!(
            self.employees
                .values()
                .filter(|e| e.company_id == company_id)
                .count()
                < 50,
            "EMPLOYEE_LIMIT"
        );
        self.employees.insert(
            k,
            Employee {
                company_id,
                employee_id,
                account_id,
                accepted: false,
            },
        );
        self.backing();
    }
    pub fn accept_employment(&mut self, company_id: String, employee_id: String) {
        let e = self
            .employees
            .get_mut(&Self::employee_key(&company_id, &employee_id))
            .expect("EMPLOYEE_NOT_FOUND");
        require!(e.account_id == env::predecessor_account_id(), "FORBIDDEN");
        e.accepted = true;
    }
    #[payable]
    pub fn fund_treasury(&mut self, company_id: String) {
        self.owner(&company_id);
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "INVALID_AMOUNT");
        let c = self.companies.get_mut(&company_id).unwrap();
        c.free = U128(c.free.0.checked_add(amount).expect("OVERFLOW"));
        c.version += 1;
        self.total_liability = self.total_liability.checked_add(amount).expect("OVERFLOW");
        self.emit(
            "TreasuryFunded",
            &company_id,
            env::predecessor_account_id(),
            amount,
        );
        self.backing();
    }
    /// A stable operation ID rejects a second deposit after a lost client result.
    #[payable]
    pub fn fund_treasury_once(&mut self, company_id: String, operation_id: String) {
        Self::id(&operation_id);
        let owner = self.owner(&company_id);
        let key = format!("fund:{}:{}", owner, operation_id);
        require!(
            !self.operations.contains_key(&key),
            "FUNDING_ALREADY_REQUESTED"
        );
        self.fund_treasury(company_id.clone());
        self.operations
            .insert(key, env::sha256(company_id.as_bytes()));
        self.backing();
    }
    pub fn authorize_mandate(
        &mut self,
        company_id: String,
        obligations: Vec<ObligationInput>,
        execution_not_after: U64,
    ) {
        self.owner(&company_id);
        require!(
            !obligations.is_empty() && obligations.len() <= 20,
            "BATCH_LIMIT"
        );
        require!(
            execution_not_after.0 > env::block_timestamp()
                && execution_not_after.0 <= env::block_timestamp().checked_add(31 * DAY).unwrap(),
            "INVALID_EXPIRY"
        );
        let mut total = 0u128;
        let mut seen = std::collections::BTreeSet::new();
        let mut additions = vec![];
        for o in obligations {
            Self::id(&o.id);
            require!(seen.insert(o.id.clone()), "DUPLICATE_OBLIGATION");
            let e = self
                .employees
                .get(&Self::employee_key(&company_id, &o.employee_id))
                .expect("EMPLOYEE_NOT_FOUND");
            require!(e.accepted, "EMPLOYMENT_NOT_ACCEPTED");
            if let Some(old) = self.obligations.get(&o.id) {
                require!(
                    old.company_id == company_id
                        && old.employee_id == o.employee_id
                        && old.amount == o.amount
                        && old.due_at == o.due_at
                        && old.execution_not_after == execution_not_after
                        && !old.cancelled,
                    "OBLIGATION_CONFLICT"
                );
                continue;
            }
            require!(
                o.amount.0 > 0
                    && o.due_at.0 >= env::block_timestamp()
                    && o.due_at.0 <= execution_not_after.0,
                "INVALID_OBLIGATION"
            );
            total = total.checked_add(o.amount.0).expect("OVERFLOW");
            additions.push(Obligation {
                id: o.id,
                company_id: company_id.clone(),
                employee_id: o.employee_id,
                account_id: e.account_id.clone(),
                amount: o.amount,
                due_at: o.due_at,
                execution_not_after,
                credited: false,
                paused: false,
                cancelled: false,
                version: 1,
            });
        }
        require!(
            self.obligations.len() as usize + additions.len() <= 2000,
            "OBLIGATION_LIMIT"
        );
        if additions.is_empty() {
            return;
        }
        let c = self.companies.get_mut(&company_id).unwrap();
        require!(c.free.0 >= total, "FULL_PREFUNDING_REQUIRED");
        c.free.0 -= total;
        c.reserved.0 = c.reserved.0.checked_add(total).expect("OVERFLOW");
        c.version += 1;
        for o in additions {
            self.obligations.insert(o.id.clone(), o);
        }
        self.emit(
            "MandateAuthorized",
            &company_id,
            env::predecessor_account_id(),
            total,
        );
        self.backing();
    }
    pub fn renew_mandate(
        &mut self,
        obligation_id: String,
        execution_not_after: U64,
        expected_version: u32,
    ) {
        let o = self
            .obligations
            .get(&obligation_id)
            .expect("OBLIGATION_NOT_FOUND")
            .clone();
        self.owner(&o.company_id);
        require!(o.version == expected_version, "VERSION_CONFLICT");
        require!(!o.credited && !o.cancelled, "INVALID_STATE");
        require!(
            execution_not_after.0 > env::block_timestamp()
                && execution_not_after.0 >= o.due_at.0
                && execution_not_after.0 <= env::block_timestamp().checked_add(31 * DAY).unwrap(),
            "INVALID_EXPIRY"
        );
        let current = self.obligations.get_mut(&obligation_id).unwrap();
        current.execution_not_after = execution_not_after;
        current.version += 1;
        self.emit(
            "MandateRenewed",
            &obligation_id,
            env::predecessor_account_id(),
            0,
        );
        self.backing();
    }
    pub fn replace_future_obligations(
        &mut self,
        obligation_id: String,
        amount: U128,
        expected_version: u32,
    ) {
        let o = self
            .obligations
            .get(&obligation_id)
            .expect("OBLIGATION_NOT_FOUND")
            .clone();
        self.owner(&o.company_id);
        require!(o.version == expected_version, "VERSION_CONFLICT");
        require!(
            !o.credited && !o.cancelled && o.due_at.0 > env::block_timestamp() && amount.0 > 0,
            "FUTURE_ONLY"
        );
        let previous_amount = o.amount.0;
        let c = self.companies.get_mut(&o.company_id).unwrap();
        if amount.0 > o.amount.0 {
            let extra = amount.0 - o.amount.0;
            require!(c.free.0 >= extra, "FULL_PREFUNDING_REQUIRED");
            c.free.0 -= extra;
            c.reserved.0 += extra;
        } else {
            let freed = o.amount.0 - amount.0;
            c.free.0 += freed;
            c.reserved.0 -= freed;
        }
        c.version += 1;
        let o = self.obligations.get_mut(&obligation_id).unwrap();
        o.amount = amount;
        o.version += 1;
        self.emit(
            if amount.0 >= previous_amount {
                "ReserveIncreased"
            } else {
                "ReserveReleased"
            },
            &obligation_id,
            env::predecessor_account_id(),
            amount.0.abs_diff(previous_amount),
        );
        self.backing();
    }
    pub fn pause_mandate(&mut self, obligation_id: String, paused: bool) {
        let o = self
            .obligations
            .get(&obligation_id)
            .expect("OBLIGATION_NOT_FOUND")
            .clone();
        self.owner(&o.company_id);
        require!(!o.credited && !o.cancelled, "INVALID_STATE");
        let o = self.obligations.get_mut(&obligation_id).unwrap();
        o.paused = paused;
        o.version += 1;
        self.emit(
            if paused {
                "MandatePaused"
            } else {
                "MandateResumed"
            },
            &obligation_id,
            env::predecessor_account_id(),
            0,
        );
        self.backing();
    }
    pub fn cancel_future_obligation(&mut self, obligation_id: String, expected_version: u32) {
        let o = self
            .obligations
            .get(&obligation_id)
            .expect("OBLIGATION_NOT_FOUND")
            .clone();
        self.owner(&o.company_id);
        require!(o.version == expected_version, "VERSION_CONFLICT");
        require!(
            !o.credited && !o.cancelled && o.due_at.0 > env::block_timestamp(),
            "FUTURE_ONLY"
        );
        let c = self.companies.get_mut(&o.company_id).unwrap();
        c.reserved.0 -= o.amount.0;
        c.free.0 += o.amount.0;
        self.obligations.get_mut(&obligation_id).unwrap().cancelled = true;
        self.obligations.get_mut(&obligation_id).unwrap().version += 1;
        self.emit(
            "ReserveReleased",
            &obligation_id,
            env::predecessor_account_id(),
            o.amount.0,
        );
        self.backing();
    }
    pub fn execute_due(&mut self, obligation_id: String) {
        require!(
            env::predecessor_account_id() == self.executor,
            "EXECUTOR_ONLY"
        );
        let o = self
            .obligations
            .get(&obligation_id)
            .expect("OBLIGATION_NOT_FOUND");
        require!(
            !o.paused && env::block_timestamp() <= o.execution_not_after.0,
            "EXECUTION_PAUSED_OR_EXPIRED"
        );
        self.credit(obligation_id);
    }
    pub fn claim_due(&mut self, obligation_id: String) {
        let o = self
            .obligations
            .get(&obligation_id)
            .expect("OBLIGATION_NOT_FOUND");
        require!(
            env::predecessor_account_id() == o.account_id,
            "EMPLOYEE_ONLY"
        );
        self.credit(obligation_id);
    }
    pub fn set_goal_policy(
        &mut self,
        goal_bps: u16,
        cash_floor: U128,
        goals: Vec<Goal>,
        expected_version: u32,
    ) {
        let account = env::predecessor_account_id();
        require!(
            !self
                .operations
                .contains_key(&format!("goal_rules:{}", account)),
            "GOAL_V2_REQUIRED"
        );
        require!(
            self.policies.contains_key(&account) || self.policies.len() < MAX_POLICIES,
            "POLICY_LIMIT"
        );
        let old = self.policies.get(&account).cloned().unwrap_or_default();
        require!(old.version == expected_version, "VERSION_CONFLICT");
        require!(goal_bps <= 10000 && goals.len() <= 10, "INVALID_POLICY");
        let mut seen = std::collections::BTreeSet::new();
        for g in &goals {
            Self::id(&g.id);
            require!(seen.insert(g.id.clone()) && g.target.0 > 0, "INVALID_GOAL");
            if let Some(previous) = old.goals.iter().find(|p| p.id == g.id) {
                require!(
                    g.funded == previous.funded
                        && g.target.0 >= g.funded.0
                        && g.completed == previous.completed
                        && g.released == previous.released,
                    "GOAL_RESERVE_PROTECTED"
                );
                require!(
                    !previous.released || g.paused,
                    "RELEASED_GOAL_CANNOT_REACTIVATE"
                );
            } else {
                require!(
                    g.funded.0 == 0 && !g.completed && !g.released,
                    "NEW_GOAL_MUST_BE_EMPTY"
                );
            }
        }
        for g in &old.goals {
            require!(
                g.funded.0 == 0 || goals.iter().any(|x| x.id == g.id),
                "FUNDED_GOAL_CANNOT_BE_REMOVED"
            );
        }
        self.policies.insert(
            account,
            GoalPolicy {
                goal_bps,
                cash_floor,
                goals,
                version: old.version + 1,
            },
        );
        self.backing();
    }
    /// Extended rules share the lazy operations map with preserved V2 records.
    pub fn set_goal_policy_v2(
        &mut self,
        goal_bps: u16,
        cash_floor: U128,
        goals: Vec<GoalInputV2>,
        expected_version: u32,
    ) {
        let account = env::predecessor_account_id();
        require!(
            self.policies.contains_key(&account) || self.policies.len() < MAX_POLICIES,
            "POLICY_LIMIT"
        );
        let old = self.policies.get(&account).cloned().unwrap_or_default();
        let old_rules = self.goal_rules(&account);
        require!(old.version == expected_version, "VERSION_CONFLICT");
        require!(goal_bps <= 10000 && goals.len() <= 10, "INVALID_POLICY");
        require!(
            old.goals.iter().all(|g| goals.iter().any(|n| n.id == g.id)),
            "GOAL_HISTORY_REQUIRED"
        );
        let mut seen = std::collections::BTreeSet::new();
        let mut next = vec![];
        let mut rules = vec![];
        for input in goals {
            let rule = input.rule;
            Self::id(&input.id);
            require!(
                seen.insert(input.id.clone())
                    && input.target.0 > 0
                    && input.priority > 0
                    && input.priority <= 10
                    && rule.id == input.id,
                "INVALID_GOAL"
            );
            require!(
                ["FIXED", "PERCENT"].contains(&rule.contribution_mode.as_str())
                    && ["SALARY", "GOAL_BUDGET"].contains(&rule.percent_basis.as_str())
                    && ["CASH", "NEXT"].contains(&rule.overflow.as_str()),
                "INVALID_CONTRIBUTION"
            );
            require!(
                rule.contribution_mode != "PERCENT" || rule.contribution_value.0 <= 10000,
                "INVALID_PERCENT"
            );
            require!(
                ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]
                    .contains(&rule.state.as_str()),
                "INVALID_STATE"
            );
            if let Some(date) = &rule.target_date {
                require!(
                    date.len() == 10 && date.as_bytes()[4] == b'-' && date.as_bytes()[7] == b'-',
                    "INVALID_DATE"
                );
            }
            let previous = old.goals.iter().find(|g| g.id == input.id);
            let funded = previous.map(|g| g.funded.0).unwrap_or(0);
            require!(input.target.0 >= funded, "TARGET_BELOW_SAVINGS");
            if let Some(g) = previous {
                require!(
                    g.target == input.target || input.confirm_changes,
                    "CONFIRM_TARGET_CHANGE"
                );
                let previous_state = old_rules
                    .iter()
                    .find(|v| v.id == g.id)
                    .map(|v| v.state.as_str())
                    .unwrap_or(if g.completed {
                        "COMPLETED"
                    } else if g.released || g.paused {
                        "PAUSED"
                    } else {
                        "ACTIVE"
                    });
                require!(
                    rule.state != "ACTIVE"
                        || previous_state == "ACTIVE"
                        || previous_state == "PAUSED" && !g.released
                        || input.confirm_changes,
                    "CONFIRM_REACTIVATION"
                );
                require!(
                    rule.state != "COMPLETED" || g.completed,
                    "INVALID_COMPLETION"
                );
            } else {
                require!(rule.state != "COMPLETED", "INVALID_COMPLETION");
            }
            let completed = rule.state == "COMPLETED" || funded >= input.target.0;
            let mut saved_rule = rule.clone();
            if completed && saved_rule.state != "ARCHIVED" {
                saved_rule.state = "COMPLETED".into();
            }
            next.push(Goal {
                id: input.id,
                target: input.target,
                funded: U128(funded),
                priority: input.priority,
                paused: saved_rule.state != "ACTIVE",
                completed,
                released: previous
                    .map(|g| g.released && saved_rule.state != "ACTIVE")
                    .unwrap_or(false),
            });
            rules.push(saved_rule);
        }
        self.save_goal_rules(&account, &rules);
        self.policies.insert(
            account,
            GoalPolicy {
                goals: next,
                goal_bps,
                cash_floor,
                version: old.version + 1,
            },
        );
        self.backing();
    }
    pub fn pause_goal(&mut self, goal_id: String, paused: bool, expected_version: u32) {
        let p = self
            .policies
            .get_mut(&env::predecessor_account_id())
            .expect("POLICY_NOT_FOUND");
        require!(p.version == expected_version, "VERSION_CONFLICT");
        let g = p
            .goals
            .iter_mut()
            .find(|g| g.id == goal_id)
            .expect("GOAL_NOT_FOUND");
        require!(!g.completed && !g.released, "GOAL_CLOSED");
        g.paused = paused;
        p.version += 1;
        let account = env::predecessor_account_id();
        let mut rules = self.goal_rules(&account);
        if let Some(rule) = rules.iter_mut().find(|r| r.id == goal_id) {
            require!(
                ["ACTIVE", "PAUSED"].contains(&rule.state.as_str()),
                "GOAL_CLOSED"
            );
            rule.state = if paused { "PAUSED" } else { "ACTIVE" }.into();
            self.save_goal_rules(&account, &rules);
        }
        self.backing();
    }
    pub fn release_goal(&mut self, goal_id: String, expected_version: u32) {
        let account = env::predecessor_account_id();
        let p = self.policies.get_mut(&account).expect("POLICY_NOT_FOUND");
        require!(p.version == expected_version, "VERSION_CONFLICT");
        let g = p
            .goals
            .iter_mut()
            .find(|g| g.id == goal_id)
            .expect("GOAL_NOT_FOUND");
        require!(!g.released, "GOAL_ALREADY_RELEASED");
        let value = g.funded.0;
        g.funded = U128(0);
        g.released = true;
        g.paused = true;
        p.version += 1;
        *self.cash.entry(account.clone()).or_default() += value;
        let completed = g.completed;
        let mut rules = self.goal_rules(&account);
        if let Some(rule) = rules.iter_mut().find(|r| r.id == goal_id) {
            if rule.state != "ARCHIVED" {
                rule.state = if completed { "COMPLETED" } else { "PAUSED" }.into();
            }
            self.save_goal_rules(&account, &rules);
        }
        self.emit("GoalReleased", &goal_id, account, value);
        self.backing();
    }
    pub fn request_withdrawal(&mut self, amount: U128, operation_id: String) -> Promise {
        let account = env::predecessor_account_id();
        self.withdraw(account, amount, operation_id, None)
    }
    pub fn withdraw_company_surplus(
        &mut self,
        company_id: String,
        amount: U128,
        operation_id: String,
    ) -> Promise {
        let account = self.owner(&company_id);
        self.withdraw(account, amount, operation_id, Some(company_id))
    }
    #[private]
    pub fn on_withdraw_result(&mut self, operation_id: String) -> bool {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "PRIVATE_CALLBACK"
        );
        require!(env::promise_results_count() == 1, "ONE_RESULT_REQUIRED");
        let w = self
            .withdrawals
            .get(&operation_id)
            .expect("WITHDRAWAL_NOT_FOUND")
            .clone();
        if w.state != "PENDING" {
            return w.state == "SUCCEEDED";
        }
        let success = env::promise_result_checked(0, 1024).is_ok();
        self.pending_withdrawals.remove(&operation_id);
        self.pending_transfers -= w.amount.0;
        if success {
            self.total_liability -= w.amount.0;
        } else if let Some(c) = &w.company_id {
            self.companies.get_mut(c).unwrap().free.0 += w.amount.0;
        } else {
            *self.cash.entry(w.account_id.clone()).or_default() += w.amount.0;
        }
        self.withdrawals.get_mut(&operation_id).unwrap().state =
            if success { "SUCCEEDED" } else { "FAILED" }.to_string();
        self.emit(
            "WithdrawalResolved",
            &operation_id,
            w.account_id,
            w.amount.0,
        );
        self.flush_history();
        success
    }
    pub fn list_companies(&self, owner_id: AccountId) -> Vec<(String, Company)> {
        Self::ordered(&self.companies)
            .filter(|(_, c)| c.owner == owner_id)
            .map(|(id, c)| (id.clone(), c.clone()))
            .collect()
    }
    pub fn list_employments(&self, account_id: AccountId) -> Vec<Employee> {
        Self::ordered(&self.employees)
            .map(|(_, value)| value)
            .filter(|e| e.account_id == account_id)
            .cloned()
            .collect()
    }
    pub fn list_company_employees(&self, company_id: String) -> Vec<Employee> {
        Self::ordered(&self.employees)
            .map(|(_, value)| value)
            .filter(|e| e.company_id == company_id)
            .cloned()
            .collect()
    }
    pub fn list_due(&self, from_index: u32, limit: u32) -> Vec<Obligation> {
        require!(limit <= 50, "LIMIT_TOO_LARGE");
        Self::ordered(&self.obligations)
            .map(|(_, value)| value)
            .filter(|o| {
                !o.credited
                    && !o.cancelled
                    && !o.paused
                    && o.due_at.0 <= env::block_timestamp()
                    && o.execution_not_after.0 >= env::block_timestamp()
            })
            .skip(from_index as usize)
            .take(limit as usize)
            .cloned()
            .collect()
    }
    pub fn get_company(&self, company_id: String) -> Option<Company> {
        self.companies.get(&company_id).cloned()
    }
    pub fn get_obligation(&self, obligation_id: String) -> Option<Obligation> {
        self.obligations.get(&obligation_id).cloned()
    }
    pub fn get_account(&self, account_id: AccountId) -> near_sdk::serde_json::Value {
        let goals = self.policies.get(&account_id).cloned().unwrap_or_default();
        near_sdk::serde_json::json!({"accountId":account_id,"network":"testnet","unit":"testNEAR","cash":U128(*self.cash.get(&account_id).unwrap_or(&0)),"policy":goals,"goalRules":self.goal_rules(&account_id),"totalLiability":U128(self.total_liability),"pendingTransfers":U128(self.pending_transfers)})
    }
    pub fn get_withdrawal(&self, operation_id: String) -> Option<Withdrawal> {
        self.withdrawals.get(&operation_id).cloned()
    }
    pub fn get_event_details(
        &self,
        from_index: u32,
        limit: u32,
    ) -> Vec<near_sdk::serde_json::Value> {
        require!(limit <= 100, "LIMIT_TOO_LARGE");
        (from_index..from_index.saturating_add(limit).min(self.events.len())).map(|index| {
            let e = self.events.get(index).unwrap();
            let details = self.operations.get(&format!("event_v2:{}", e.event_sequence.0)).map(|v| near_sdk::serde_json::from_slice::<near_sdk::serde_json::Value>(v).unwrap());
            near_sdk::serde_json::json!({"sequence":e.event_sequence,"event":e,"details":details})
        }).collect()
    }
    pub fn financial_summary(&self) -> near_sdk::serde_json::Value {
        let company_total: u128 = self
            .companies
            .values()
            .map(|c| c.free.0 + c.reserved.0)
            .sum();
        let cash: u128 = self.cash.values().sum();
        let goals: u128 = self
            .policies
            .values()
            .flat_map(|p| &p.goals)
            .map(|g| g.funded.0)
            .sum();
        let reservations: Vec<_> = Self::ordered(&self.companies).map(|(id,c)| {
            let expected: u128 = self.obligations.values().filter(|o| o.company_id == *id && !o.credited && !o.cancelled).map(|o| o.amount.0).sum();
            near_sdk::serde_json::json!({"companyId":id,"reserved":c.reserved,"expected":U128(expected),"valid":expected == c.reserved.0})
        }).collect();
        let computed = company_total + cash + goals + self.pending_transfers;
        let storage_reserve = self.storage_reserve();
        let backing_required = self.total_liability - self.pending_transfers + storage_reserve;
        near_sdk::serde_json::json!({"version":2,"storageVersion":self.storage_version,"unit":"testNEAR","decimals":24,"network":"testnet","eventCount":self.events.len(),"maxEvents":u32::MAX,"reservedCallbackEventSlots":self.pending_withdrawals.len(),"obligationCount":self.obligations.len(),"maxObligations":2000,"companyCount":self.companies.len(),"maxCompanies":30,"withdrawalCount":self.withdrawal_count,"maxWithdrawals":null,"maxPendingWithdrawals":MAX_PENDING_WITHDRAWALS,"pendingWithdrawalCount":self.pending_withdrawals.len(),"callbackStorageBytes":CALLBACK_STORAGE_BYTES,"maxPolicies":MAX_POLICIES,"pending":self.pending_withdrawals.iter().collect::<std::collections::BTreeSet<_>>().into_iter().map(|id| { let w = self.withdrawals.get(id).expect("PENDING_INDEX_INVARIANT"); near_sdk::serde_json::json!({"id":id,"amount":w.amount,"accountId":w.account_id,"companyId":w.company_id}) }).collect::<Vec<_>>(),"companyTotal":U128(company_total),"employeeCash":U128(cash),"employeeGoals":U128(goals),"pendingTransfers":U128(self.pending_transfers),"totalLiability":U128(self.total_liability),"computedLiability":U128(computed),"liabilityValid":computed == self.total_liability,"reservations":reservations,"timestampNs":U64(env::block_timestamp()),"accountBalance":U128(env::account_balance().as_yoctonear()),"storageReserve":U128(storage_reserve),"backingRequired":U128(backing_required),"backingValid":env::account_balance().as_yoctonear() >= backing_required})
    }
    pub fn list_events(&self, from_index: u32, limit: u32) -> Vec<Event> {
        require!(limit <= 100, "LIMIT_TOO_LARGE");
        (from_index..from_index.saturating_add(limit).min(self.events.len()))
            .map(|index| self.events.get(index).unwrap().clone())
            .collect()
    }
    pub fn list_obligations(
        &self,
        account_id: AccountId,
        from_index: u32,
        limit: u32,
    ) -> Vec<Obligation> {
        require!(limit <= 100, "LIMIT_TOO_LARGE");
        Self::ordered(&self.obligations)
            .map(|(_, value)| value)
            .filter(|o| o.account_id == account_id)
            .skip(from_index as usize)
            .take(limit as usize)
            .cloned()
            .collect()
    }
}
impl Contract {
    // IterableMap stores insertion order; external V2 lists used sorted keys.
    // Sorting is confined to bounded views, never withdrawal callbacks.
    fn ordered<K, V>(map: &IterableMap<K, V>) -> impl Iterator<Item = (&K, &V)>
    where
        K: BorshSerialize + BorshDeserialize + Ord + Clone,
        V: BorshSerialize + BorshDeserialize,
    {
        let mut rows: Vec<_> = map.iter().collect();
        rows.sort_unstable_by(|(a, _), (b, _)| a.cmp(b));
        rows.into_iter()
    }
    fn id(v: &str) {
        require!(
            !v.is_empty()
                && v.len() <= 100
                && v.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'),
            "INVALID_OPAQUE_ID"
        );
    }
    fn employee_key(company: &str, employee: &str) -> String {
        format!("{}:{}", company, employee)
    }
    fn owner(&self, id: &str) -> AccountId {
        let owner = self
            .companies
            .get(id)
            .expect("COMPANY_NOT_FOUND")
            .owner
            .clone();
        require!(owner == env::predecessor_account_id(), "OWNER_ONLY");
        owner
    }
    fn emit(&mut self, kind: &str, reference: &str, account: AccountId, value: u128) {
        // Preserve one physical Vector slot per in-flight callback. The previous
        // 12,000-event business cap is gone; only the SDK u32 index bound remains.
        require!(
            self.events.len() < u32::MAX - self.pending_withdrawals.len() as u32,
            "EVENT_INDEX_EXHAUSTED"
        );
        let e = Event {
            event_sequence: U64(self.events.len() as u64 + 1),
            event_type: kind.to_string(),
            reference: reference.to_string(),
            account_id: account,
            amount: U128(value),
        };
        let details = near_sdk::serde_json::json!({"schemaVersion":2,"timestampNs":U64(env::block_timestamp()),"obligation":self.obligations.get(reference),"withdrawal":self.withdrawals.get(reference)});
        self.operations.insert(
            format!("event_v2:{}", e.event_sequence.0),
            near_sdk::serde_json::to_vec(&details).unwrap(),
        );
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({"standard":"noma_payroll","version":"1.0.0","event":kind,"data":[{"event":e.clone(),"details":details}]})
        ));
        self.events.push(e);
    }
    fn flush_history(&mut self) {
        // SDK store collections write back on drop. Flush before measuring trie
        // storage so newly appended history is never omitted from collateral.
        self.companies.flush();
        self.employees.flush();
        self.obligations.flush();
        self.cash.flush();
        self.policies.flush();
        self.pending_withdrawals.flush();
        self.withdrawals.flush();
        self.operations.flush();
        self.events.flush();
    }
    fn storage_reserve(&self) -> u128 {
        let state_bytes = borsh::to_vec(self).unwrap().len() as u64;
        let old_state = env::storage_read(b"STATE");
        let old_bytes = old_state.as_ref().map_or(0, |bytes| bytes.len() as u64);
        // A first STATE write also needs its key and trie record overhead.
        let state_overhead = if old_state.is_none() { 45 } else { 0 };
        let bytes = env::storage_usage()
            .checked_sub(old_bytes)
            .expect("STORAGE_USAGE_INVARIANT")
            .checked_add(state_bytes)
            .unwrap()
            .checked_add(state_overhead)
            .unwrap()
            .checked_add(self.pending_withdrawals.len() as u64 * CALLBACK_STORAGE_BYTES)
            .unwrap();
        u128::from(bytes)
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .unwrap()
            + NearToken::from_millinear(100).as_yoctonear()
    }
    fn backing(&mut self) {
        self.backing_with_outgoing(0);
    }
    fn backing_with_outgoing(&mut self, outgoing: u128) {
        self.flush_history();
        let required = (self.total_liability - self.pending_transfers)
            .checked_add(self.storage_reserve())
            .unwrap()
            .checked_add(outgoing)
            .unwrap();
        require!(
            env::account_balance().as_yoctonear() >= required,
            "STORAGE_RESERVE_REQUIRED"
        );
    }
    fn goal_rules(&self, account: &AccountId) -> Vec<GoalRule> {
        self.operations
            .get(&format!("goal_rules:{}", account))
            .map(|bytes| near_sdk::serde_json::from_slice(bytes).expect("INVALID_STORED_RULES"))
            .unwrap_or_default()
    }
    fn save_goal_rules(&mut self, account: &AccountId, rules: &[GoalRule]) {
        self.operations.insert(
            format!("goal_rules:{}", account),
            near_sdk::serde_json::to_vec(rules).unwrap(),
        );
    }
    fn bps(value: u128, bps: u128) -> u128 {
        value / 10000 * bps + value % 10000 * bps / 10000
    }
    fn goal_distribution(
        total: u128,
        budget: u128,
        goals: &mut [Goal],
        rules: &mut [GoalRule],
    ) -> Vec<(String, u128, bool)> {
        let mut available = budget;
        let mut carry = 0u128;
        let mut result = vec![];
        goals.sort_by_key(|g| g.priority);
        for g in goals
            .iter_mut()
            .filter(|g| !g.paused && !g.completed && !g.released)
        {
            let rule = rules.iter_mut().find(|r| r.id == g.id);
            if rule.as_ref().is_some_and(|r| r.state != "ACTIVE") {
                continue;
            }
            let requested_base = match rule.as_ref() {
                Some(r) if r.contribution_mode == "FIXED" => r.contribution_value.0,
                Some(r) => Self::bps(
                    if r.percent_basis == "SALARY" {
                        total
                    } else {
                        budget
                    },
                    r.contribution_value.0,
                ),
                None => budget,
            };
            let requested = requested_base.saturating_add(carry).min(available);
            let take = requested.min(g.target.0.saturating_sub(g.funded.0));
            let excess = requested - take;
            available -= requested;
            carry = if rule.as_ref().map(|r| r.overflow.as_str()).unwrap_or("NEXT") == "NEXT" {
                excess
            } else {
                0
            };
            available += carry;
            if take > 0 {
                g.funded.0 += take;
                g.completed = g.funded.0 == g.target.0;
                if let Some(r) = rule {
                    if g.completed {
                        r.state = "COMPLETED".into();
                    }
                }
                result.push((g.id.clone(), take, g.completed));
            }
        }
        result
    }
    fn credit(&mut self, id: String) {
        let o = self
            .obligations
            .get(&id)
            .expect("OBLIGATION_NOT_FOUND")
            .clone();
        if o.credited {
            return;
        }
        require!(
            !o.cancelled && env::block_timestamp() >= o.due_at.0,
            "NOT_DUE_OR_CANCELLED"
        );
        let c = self.companies.get_mut(&o.company_id).unwrap();
        require!(c.reserved.0 >= o.amount.0, "RESERVE_INVARIANT");
        c.reserved.0 -= o.amount.0;
        let mut cash = o.amount.0;
        let mut goal_events = vec![];
        let mut rules = self.goal_rules(&o.account_id);
        let extended = !rules.is_empty();
        if let Some(p) = self.policies.get_mut(&o.account_id) {
            let optional = Self::bps(o.amount.0, p.goal_bps as u128);
            let cash_min = p.cash_floor.0.min(o.amount.0);
            let budget = optional.min(o.amount.0 - cash_min);
            goal_events = Self::goal_distribution(o.amount.0, budget, &mut p.goals, &mut rules);
            cash -= goal_events.iter().map(|(_, v, _)| v).sum::<u128>();
            p.version += 1;
        }
        if extended {
            self.save_goal_rules(&o.account_id, &rules);
        }
        *self.cash.entry(o.account_id.clone()).or_default() += cash;
        self.obligations.get_mut(&id).unwrap().credited = true;
        self.emit("PayrollCredited", &id, o.account_id.clone(), o.amount.0);
        for (goal, value, completed) in goal_events {
            self.emit("GoalFunded", &goal, o.account_id.clone(), value);
            if completed {
                self.emit("GoalCompleted", &goal, o.account_id.clone(), value);
            }
        }
        self.backing();
    }
    fn withdraw(
        &mut self,
        account: AccountId,
        amount: U128,
        operation_id: String,
        company_id: Option<String>,
    ) -> Promise {
        Self::id(&operation_id);
        require!(amount.0 > 0, "INVALID_AMOUNT");
        require!(
            self.pending_withdrawals.len() < MAX_PENDING_WITHDRAWALS,
            "PENDING_WITHDRAWAL_LIMIT"
        );
        require!(
            !self.withdrawals.contains_key(&operation_id),
            "WITHDRAWAL_ALREADY_REQUESTED"
        );
        if let Some(c) = &company_id {
            let c = self.companies.get_mut(c).unwrap();
            require!(c.free.0 >= amount.0, "INSUFFICIENT_FREE_TREASURY");
            c.free.0 -= amount.0;
        } else {
            let cash = self.cash.entry(account.clone()).or_default();
            require!(*cash >= amount.0, "INSUFFICIENT_FREE_CASH");
            *cash -= amount.0;
        }
        self.withdrawals.insert(
            operation_id.clone(),
            Withdrawal {
                account_id: account.clone(),
                amount,
                state: "PENDING".to_string(),
                company_id,
            },
        );
        self.withdrawal_count = self.withdrawal_count.checked_add(1).expect("OVERFLOW");
        self.pending_withdrawals.insert(operation_id.clone());
        self.pending_transfers = self.pending_transfers.checked_add(amount.0).unwrap();
        self.emit(
            "WithdrawalRequested",
            &operation_id,
            account.clone(),
            amount.0,
        );
        // The current receipt still owns the amount being dispatched. Reserve
        // its post-transfer balance as well as storage for every later callback.
        self.backing_with_outgoing(amount.0);
        Promise::new(account)
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(20))
                    .on_withdraw_result(operation_id),
            )
    }
}
#[cfg(test)]
mod tests {
    include!("v3_tests.rs");
    include!("lazy_business_tests.rs");
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;
    fn context(who: AccountId, time: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0))
            .predecessor_account_id(who)
            .account_balance(NearToken::from_near(100))
            .block_timestamp(time);
        testing_env!(b.build());
    }
    fn setup() -> Contract {
        context(accounts(1), 100);
        let mut c = Contract::new(accounts(3));
        c.register_company("studio".into(), "register".into());
        c.register_employee("studio".into(), "e1".into(), accounts(2));
        context(accounts(2), 100);
        c.accept_employment("studio".into(), "e1".into());
        context(accounts(1), 100);
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_near(1))
            .block_timestamp(100);
        testing_env!(b.build());
        c.fund_treasury("studio".into());
        c
    }
    fn authorize(c: &mut Contract) {
        context(accounts(1), 100);
        c.authorize_mandate(
            "studio".into(),
            vec![ObligationInput {
                id: "o1".into(),
                employee_id: "e1".into(),
                amount: U128(10000),
                due_at: U64(200),
            }],
            U64(1000),
        );
    }
    #[test]
    fn funded_salary_allocates_goals_atomically() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(2), 100);
        c.set_goal_policy(
            5000,
            U128(2000),
            vec![Goal {
                id: "g1".into(),
                target: U128(3000),
                funded: U128(0),
                priority: 1,
                paused: false,
                completed: false,
                released: false,
            }],
            0,
        );
        context(accounts(3), 201);
        c.execute_due("o1".into());
        assert_eq!(*c.cash.get(&accounts(2)).unwrap(), 7000);
        assert_eq!(
            c.policies.get(&accounts(2)).unwrap().goals[0].funded.0,
            3000
        );
        assert!(c.policies.get(&accounts(2)).unwrap().goals[0].completed);
        c.execute_due("o1".into());
        assert_eq!(*c.cash.get(&accounts(2)).unwrap(), 7000);
    }
    #[test]
    fn paused_employee_can_claim() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(1), 100);
        c.pause_mandate("o1".into(), true);
        context(accounts(2), 2000);
        c.claim_due("o1".into());
        assert!(c.obligations.get("o1").unwrap().credited);
    }
    #[test]
    #[should_panic(expected = "FULL_PREFUNDING_REQUIRED")]
    fn requires_full_funding() {
        let mut c = setup();
        context(accounts(1), 100);
        c.authorize_mandate(
            "studio".into(),
            vec![ObligationInput {
                id: "too_much".into(),
                employee_id: "e1".into(),
                amount: U128(NearToken::from_near(2).as_yoctonear()),
                due_at: U64(200),
            }],
            U64(1000),
        );
    }
    #[test]
    #[should_panic(expected = "OWNER_ONLY")]
    fn only_owner_funds() {
        let mut c = setup();
        context(accounts(2), 100);
        c.fund_treasury("studio".into());
    }
    #[test]
    #[should_panic(expected = "INSUFFICIENT_FREE_CASH")]
    fn goal_reserves_cannot_be_withdrawn() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(2), 100);
        c.set_goal_policy(
            10000,
            U128(0),
            vec![Goal {
                id: "g".into(),
                target: U128(20000),
                funded: U128(0),
                priority: 1,
                paused: false,
                completed: false,
                released: false,
            }],
            0,
        );
        context(accounts(3), 201);
        c.execute_due("o1".into());
        context(accounts(2), 202);
        let _ = c.request_withdrawal(U128(1), "w1".into());
    }
    #[test]
    fn duplicate_funding_operation_does_not_credit_twice() {
        let mut c = setup();
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_millinear(10));
        testing_env!(b.build());
        c.fund_treasury_once("studio".into(), "fund-once".into());
        let first = c.companies.get("studio").unwrap().free.0;
        let second = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.fund_treasury_once("studio".into(), "fund-once".into())
        }));
        assert!(second.is_err());
        assert_eq!(c.companies.get("studio").unwrap().free.0, first);
    }
    fn result_context(result: near_sdk::PromiseResult) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .account_balance(NearToken::from_near(100))
            .block_timestamp(300);
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::default(),
            vec![result]
        );
    }
    #[test]
    fn failed_transfer_restores_cash_once() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(3), 201);
        c.execute_due("o1".into());
        context(accounts(2), 202);
        let _ = c.request_withdrawal(U128(4000), "withdraw".into());
        assert_eq!(*c.cash.get(&accounts(2)).unwrap(), 6000);
        let liability = c.total_liability;
        result_context(near_sdk::PromiseResult::Failed);
        assert!(!c.on_withdraw_result("withdraw".into()));
        assert_eq!(*c.cash.get(&accounts(2)).unwrap(), 10000);
        assert_eq!(c.total_liability, liability);
        assert_eq!(c.pending_transfers, 0);
        assert!(!c.on_withdraw_result("withdraw".into()));
        assert_eq!(*c.cash.get(&accounts(2)).unwrap(), 10000);
    }
    #[test]
    fn successful_transfer_reduces_liability_once() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(3), 201);
        c.execute_due("o1".into());
        context(accounts(2), 202);
        let _ = c.request_withdrawal(U128(4000), "withdraw".into());
        let liability = c.total_liability;
        result_context(near_sdk::PromiseResult::Successful(vec![]));
        assert!(c.on_withdraw_result("withdraw".into()));
        assert_eq!(c.total_liability, liability - 4000);
        assert_eq!(c.pending_transfers, 0);
        assert!(c.on_withdraw_result("withdraw".into()));
        assert_eq!(c.total_liability, liability - 4000);
    }
    #[test]
    #[should_panic(expected = "PRIVATE_CALLBACK")]
    fn callback_cannot_be_forged() {
        let mut c = setup();
        context(accounts(2), 300);
        c.on_withdraw_result("missing".into());
    }

    #[test]
    fn shared_savings_vectors_match_typescript() {
        let vectors: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(include_str!(
            "../../../tests/fixtures/goal-vectors.json"
        ))
        .unwrap();
        for v in vectors.as_array().unwrap() {
            let text = |x: &near_sdk::serde_json::Value, key: &str, default: &str| {
                x.get(key)
                    .and_then(|v| v.as_str())
                    .unwrap_or(default)
                    .to_string()
            };
            let mut goals = vec![];
            let mut rules = vec![];
            for g in v["goals"].as_array().unwrap() {
                let state = text(g, "state", "ACTIVE");
                goals.push(Goal {
                    id: text(g, "id", ""),
                    target: U128(text(g, "target", "0").parse().unwrap()),
                    funded: U128(text(g, "funded", "0").parse().unwrap()),
                    priority: g["priority"].as_u64().unwrap() as u8,
                    paused: state != "ACTIVE",
                    completed: state == "COMPLETED",
                    released: false,
                });
                rules.push(GoalRule {
                    id: text(g, "id", ""),
                    contribution_mode: text(g, "contributionMode", "PERCENT"),
                    contribution_value: U128(
                        text(g, "contributionValue", "10000").parse().unwrap(),
                    ),
                    percent_basis: text(g, "percentBasis", "GOAL_BUDGET"),
                    overflow: text(g, "overflow", "NEXT"),
                    target_date: None,
                    state,
                });
            }
            let result = Contract::goal_distribution(
                text(v, "total", "0").parse().unwrap(),
                text(v, "budget", "0").parse().unwrap(),
                &mut goals,
                &mut rules,
            );
            let actual: Vec<_> = result
                .iter()
                .map(|(id, value, _)| near_sdk::serde_json::json!([id, value.to_string()]))
                .collect();
            assert_eq!(
                near_sdk::serde_json::json!(actual),
                v["expected"],
                "{}",
                v["name"]
            );
        }
    }
    #[test]
    fn v2_goal_release_requires_explicit_reactivation_and_preserves_layout() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(2), 100);
        let rule = GoalRule {
            id: "g1".into(),
            contribution_mode: "FIXED".into(),
            contribution_value: U128(200),
            percent_basis: "GOAL_BUDGET".into(),
            overflow: "CASH".into(),
            target_date: Some("2026-12-01".into()),
            state: "ACTIVE".into(),
        };
        c.set_goal_policy_v2(
            5000,
            U128(0),
            vec![GoalInputV2 {
                id: "g1".into(),
                target: U128(600),
                priority: 1,
                rule: rule.clone(),
                confirm_changes: true,
            }],
            0,
        );
        context(accounts(3), 201);
        c.execute_due("o1".into());
        assert_eq!(c.policies[&accounts(2)].goals[0].funded.0, 200);
        assert_eq!(c.cash[&accounts(2)], 9800);
        context(accounts(2), 202);
        c.release_goal("g1".into(), 2);
        assert_eq!(c.goal_rules(&accounts(2))[0].state, "PAUSED");
        assert_eq!(c.cash[&accounts(2)], 10000);
        c.set_goal_policy_v2(
            5000,
            U128(0),
            vec![GoalInputV2 {
                id: "g1".into(),
                target: U128(600),
                priority: 1,
                rule,
                confirm_changes: true,
            }],
            3,
        );
        assert!(!c.policies[&accounts(2)].goals[0].released);
        c.flush_history();
        let bytes = near_sdk::borsh::to_vec(&c).unwrap();
        let restored = Contract::try_from_slice(&bytes).unwrap();
        assert_eq!(
            restored.goal_rules(&accounts(2))[0].contribution_value.0,
            200
        );
    }
    #[test]
    fn renewal_preserves_debt_and_all_balances() {
        let mut c = setup();
        authorize(&mut c);
        let before = c.financial_summary();
        context(accounts(1), 1100);
        c.renew_mandate("o1".into(), U64(2500), 1);
        assert_eq!(c.obligations["o1"].amount.0, 10000);
        assert_eq!(c.obligations["o1"].version, 2);
        assert_eq!(
            c.financial_summary()["totalLiability"],
            before["totalLiability"]
        );
        context(accounts(3), 1200);
        c.execute_due("o1".into());
        assert!(c.obligations["o1"].credited);
        assert_eq!(c.financial_summary()["liabilityValid"], true);
    }
    #[test]
    #[should_panic(expected = "OWNER_ONLY")]
    fn executor_cannot_renew_authority() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(3), 1100);
        c.renew_mandate("o1".into(), U64(2500), 1);
    }
    #[test]
    fn amendments_cancel_and_events_preserve_financial_invariants() {
        let mut c = setup();
        authorize(&mut c);
        for n in 0..60u32 {
            context(accounts(1), 101);
            let value = if n % 2 == 0 {
                10000 + n as u128 * 79
            } else {
                5000 + n as u128 * 17
            };
            c.replace_future_obligations("o1".into(), U128(value), n + 1);
            let summary = c.financial_summary();
            assert_eq!(summary["liabilityValid"], true);
            assert_eq!(summary["backingValid"], true);
            assert_eq!(summary["reservations"][0]["valid"], true);
            let row = c.get_event_details(c.events.len() as u32 - 1, 1);
            assert_eq!(row[0]["details"]["obligation"]["amount"], value.to_string());
        }
        c.cancel_future_obligation("o1".into(), 61);
        assert_eq!(c.companies["studio"].reserved.0, 0);
        assert_eq!(c.financial_summary()["reservations"][0]["valid"], true);
        c.flush_history();
        let restored = Contract::try_from_slice(&borsh::to_vec(&c).unwrap()).unwrap();
        assert_eq!(
            restored.get_event_details(0, 100),
            c.get_event_details(0, 100)
        );
    }

    #[test]
    #[should_panic(expected = "NOT_DUE_OR_CANCELLED")]
    fn executor_cannot_credit_before_payday() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(3), 199);
        c.execute_due("o1".into());
    }
    #[test]
    #[should_panic(expected = "EXECUTION_PAUSED_OR_EXPIRED")]
    fn executor_cannot_credit_after_authority_expiry() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(3), 1001);
        c.execute_due("o1".into());
    }
    #[test]
    #[should_panic(expected = "INSUFFICIENT_FREE_TREASURY")]
    fn company_cannot_withdraw_reserved_salary() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(1), 201);
        let free = c.companies.get("studio").unwrap().free.0;
        let _ = c.withdraw_company_surplus("studio".into(), U128(free + 1), "overdraw".into());
    }
    #[test]
    fn unknown_transfer_stays_reserved_and_cannot_be_resubmitted() {
        let mut c = setup();
        authorize(&mut c);
        context(accounts(3), 201);
        c.execute_due("o1".into());
        context(accounts(2), 202);
        let _ = c.request_withdrawal(U128(4000), "unknown".into());
        let liability = c.total_liability;
        assert_eq!(*c.cash.get(&accounts(2)).unwrap(), 6000);
        assert_eq!(c.pending_transfers, 4000);
        let repeated = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.request_withdrawal(U128(4000), "unknown".into())
        }));
        assert!(repeated.is_err());
        assert_eq!(*c.cash.get(&accounts(2)).unwrap(), 6000);
        assert_eq!(c.total_liability, liability);
    }
}
