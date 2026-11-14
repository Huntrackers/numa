const LEGACY_MAX_EVENTS: u32 = 12_000;

// Reset gas between receipts while retaining the mock trie and its usage.
fn receipt_context(who: AccountId, balance: u128) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(accounts(0))
        .predecessor_account_id(who)
        .account_balance(NearToken::from_yoctonear(balance))
        .storage_usage(env::storage_usage())
        .block_timestamp(300);
    testing_env!(b.build());
}

fn persist(c: &mut Contract) {
    c.flush_history();
    env::state_write(c);
    let reloaded: Contract = env::state_read().unwrap();
    *c = reloaded;
}

fn grow_history(c: &mut Contract, count: u32) {
    while c.events.len() < count {
        receipt_context(accounts(1), NearToken::from_near(100).as_yoctonear());
        for _ in 0..50.min(count - c.events.len()) {
            c.emit("HistoryFixture", "history", accounts(1), 0);
        }
        persist(c);
    }
}

#[test]
fn v3_employee_claim_and_goal_events_cross_legacy_cap() {
    let mut c = setup();
    authorize(&mut c);
    context(accounts(2), 100);
    c.set_goal_policy(
        5000,
        U128(0),
        vec![Goal {
            id: "goal".into(),
            target: U128(3000),
            funded: U128(0),
            priority: 1,
            paused: false,
            completed: false,
            released: false,
        }],
        0,
    );
    grow_history(&mut c, LEGACY_MAX_EVENTS);
    let state_size = borsh::to_vec(&c).unwrap().len();
    receipt_context(accounts(2), NearToken::from_near(100).as_yoctonear());
    c.claim_due("o1".into());
    assert_eq!(c.cash[&accounts(2)], 7000);
    assert_eq!(c.events.len(), LEGACY_MAX_EVENTS + 3);
    assert_eq!(
        c.list_events(LEGACY_MAX_EVENTS, 100)
            .iter()
            .map(|e| e.event_type.as_str())
            .collect::<Vec<_>>(),
        vec!["PayrollCredited", "GoalFunded", "GoalCompleted"]
    );
    assert_eq!(
        c.get_event_details(LEGACY_MAX_EVENTS, 1)[0]["details"]["schemaVersion"],
        2
    );
    assert_eq!(c.financial_summary()["liabilityValid"], true);
    // A newly introduced cash-map account is the only native state growth.
    assert!(borsh::to_vec(&c).unwrap().len() - state_size < 100);
    assert!(c.list_events(u32::MAX, 100).is_empty());
    assert!(c.get_event_details(u32::MAX, 100).is_empty());
    persist(&mut c);
    receipt_context(accounts(2), NearToken::from_near(100).as_yoctonear());
    c.claim_due("o1".into());
    assert_eq!(c.events.len(), LEGACY_MAX_EVENTS + 3);
}

#[test]
fn v3_callbacks_cross_legacy_cap_and_remain_idempotent() {
    let mut c = setup();
    authorize(&mut c);
    context(accounts(2), 201);
    c.claim_due("o1".into());
    grow_history(&mut c, LEGACY_MAX_EVENTS - 1);
    receipt_context(accounts(2), NearToken::from_near(100).as_yoctonear());
    drop(c.request_withdrawal(U128(4000), "success-at-cap".into()));
    assert_eq!(c.events.len(), LEGACY_MAX_EVENTS);
    persist(&mut c);
    let liability = c.total_liability;
    result_context(near_sdk::PromiseResult::Successful(vec![]));
    assert!(c.on_withdraw_result("success-at-cap".into()));
    assert!(c.on_withdraw_result("success-at-cap".into()));
    assert_eq!(c.total_liability, liability - 4000);
    assert_eq!(c.events.len(), LEGACY_MAX_EVENTS + 1);
    assert!(c.pending_withdrawals.is_empty());
    context(accounts(2), 301);
    drop(c.request_withdrawal(U128(3000), "failure-past-cap".into()));
    result_context(near_sdk::PromiseResult::Failed);
    assert!(!c.on_withdraw_result("failure-past-cap".into()));
    assert!(!c.on_withdraw_result("failure-past-cap".into()));
    assert_eq!(c.cash[&accounts(2)], 6000);
    assert_eq!(c.pending_transfers, 0);
    assert_eq!(c.events.len(), LEGACY_MAX_EVENTS + 3);
    assert_eq!(
        c.get_event_details(LEGACY_MAX_EVENTS + 2, 1)[0]["details"]["withdrawal"]["state"],
        "FAILED"
    );
    assert_eq!(c.financial_summary()["liabilityValid"], true);
}

#[test]
fn v3_more_than_2000_archived_receipts_do_not_block_new_withdrawals() {
    let mut c = setup();
    authorize(&mut c);
    context(accounts(2), 201);
    c.claim_due("o1".into());
    let size = borsh::to_vec(&c).unwrap().len();
    for n in 0..2001 {
        receipt_context(accounts(2), NearToken::from_near(100).as_yoctonear());
        drop(c.request_withdrawal(U128(1), format!("paid-{n}")));
        persist(&mut c);
        result_context(near_sdk::PromiseResult::Successful(vec![]));
        assert!(c.on_withdraw_result(format!("paid-{n}")));
        persist(&mut c);
    }
    assert_eq!(borsh::to_vec(&c).unwrap().len(), size);
    assert_eq!(c.withdrawal_count, 2001);
    assert!(c.pending_withdrawals.is_empty());
    receipt_context(accounts(2), NearToken::from_near(100).as_yoctonear());
    let replay = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.request_withdrawal(U128(1), "paid-0".into())
    }));
    assert!(replay.is_err());
    drop(c.request_withdrawal(U128(1), "after-2001".into()));
    assert_eq!(c.withdrawal_count, 2002);
    assert_eq!(
        c.get_withdrawal("paid-0".into()).unwrap().state,
        "SUCCEEDED"
    );
    assert_eq!(
        c.financial_summary()["maxWithdrawals"],
        near_sdk::serde_json::Value::Null
    );
    assert_eq!(c.financial_summary()["pendingWithdrawalCount"], 1);
}

#[test]
fn v3_outgoing_amount_cannot_be_used_as_callback_storage_collateral() {
    let mut c = setup();
    authorize(&mut c);
    context(accounts(2), 201);
    c.claim_due("o1".into());
    persist(&mut c);
    // Give the withdrawing account the company free treasury too, so this
    // tests the otherwise dangerous case where transfer exceeds free stake.
    let amount = c.companies.get_mut("studio").unwrap().free.0;
    c.companies.get_mut("studio").unwrap().free.0 = 0;
    *c.cash.get_mut(&accounts(2)).unwrap() += amount;
    let reserve = c.storage_reserve();
    let balance = c.total_liability
        + reserve
        + u128::from(CALLBACK_STORAGE_BYTES / 2) * env::storage_byte_cost().as_yoctonear();
    receipt_context(accounts(2), balance);
    let cash = c.cash[&accounts(2)];
    let request = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.request_withdrawal(U128(cash), "underfunded-callback".into())
    }));
    assert!(request.is_err());
    // Native tests do not roll back panics; the chain rolls this receipt back.
    assert!(near_sdk::test_utils::get_created_receipts().is_empty());
}

#[test]
fn v3_callback_storage_upper_bound_covers_maximum_ids_and_details() {
    let mut c = setup();
    let id = "w".repeat(100);
    let account: AccountId = "a".repeat(64).parse().unwrap();
    let amount = u128::MAX / 4;
    c.obligations.insert(
        id.clone(),
        Obligation {
            id: id.clone(),
            company_id: "c".repeat(100),
            employee_id: "e".repeat(100),
            account_id: account.clone(),
            amount: U128(amount),
            due_at: U64(u64::MAX),
            execution_not_after: U64(u64::MAX),
            credited: true,
            paused: false,
            cancelled: false,
            version: u32::MAX,
        },
    );
    c.cash.insert(account.clone(), 0);
    c.companies.insert(
        "c".repeat(100),
        Company {
            owner: account.clone(),
            free: U128(0),
            reserved: U128(0),
            version: 1,
        },
    );
    c.withdrawals.insert(
        id.clone(),
        Withdrawal {
            account_id: account,
            amount: U128(amount),
            state: "PENDING".into(),
            company_id: Some("c".repeat(100)),
        },
    );
    c.pending_withdrawals.insert(id.clone());
    c.pending_transfers = amount;
    c.total_liability = amount;
    persist(&mut c);
    let before = env::storage_usage();
    let mut b = VMContextBuilder::new();
    b.current_account_id(accounts(0))
        .predecessor_account_id(accounts(0))
        .account_balance(NearToken::from_near(100))
        .storage_usage(before)
        .block_timestamp(u64::MAX);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        std::collections::HashMap::default(),
        vec![near_sdk::PromiseResult::Failed]
    );
    assert!(!c.on_withdraw_result(id.clone()));
    let growth = env::storage_usage().saturating_sub(before);
    assert!(growth < CALLBACK_STORAGE_BYTES, "callback growth {growth}");
    assert_eq!(c.companies[&"c".repeat(100)].free.0, amount);
    assert_eq!(
        c.get_event_details(c.events.len() - 1, 1)[0]["details"]["obligation"]["id"],
        id
    );
    println!(
        "Maximum-ID callback storage growth: {growth} bytes; reserve: {CALLBACK_STORAGE_BYTES}"
    );
}

fn legacy_fixture() -> ContractV2 {
    let mut old = ContractV2 {
        executor: accounts(3),
        companies: BTreeMap::new(),
        employees: BTreeMap::new(),
        obligations: BTreeMap::new(),
        cash: BTreeMap::new(),
        policies: BTreeMap::new(),
        withdrawals: BTreeMap::new(),
        operations: BTreeMap::new(),
        events: vec![],
        total_liability: 20_000,
        pending_transfers: 5000,
    };
    old.companies.insert(
        "studio".into(),
        Company {
            owner: accounts(1),
            free: U128(2000),
            reserved: U128(10_000),
            version: 7,
        },
    );
    old.employees.insert(
        "studio:e1".into(),
        Employee {
            company_id: "studio".into(),
            employee_id: "e1".into(),
            account_id: accounts(2),
            accepted: true,
        },
    );
    old.obligations.insert(
        "salary".into(),
        Obligation {
            id: "salary".into(),
            company_id: "studio".into(),
            employee_id: "e1".into(),
            account_id: accounts(2),
            amount: U128(10_000),
            due_at: U64(200),
            execution_not_after: U64(1000),
            credited: false,
            paused: true,
            cancelled: false,
            version: 4,
        },
    );
    old.cash.insert(accounts(2), 1000);
    old.policies.insert(
        accounts(2),
        GoalPolicy {
            goals: vec![Goal {
                id: "goal".into(),
                target: U128(5000),
                funded: U128(2000),
                priority: 1,
                paused: false,
                completed: false,
                released: false,
            }],
            goal_bps: 5000,
            cash_floor: U128(100),
            version: 9,
        },
    );
    let rules = vec![GoalRule {
        id: "goal".into(),
        contribution_mode: "FIXED".into(),
        contribution_value: U128(500),
        percent_basis: "SALARY".into(),
        overflow: "CASH".into(),
        target_date: Some("2026-12-01".into()),
        state: "ACTIVE".into(),
    }];
    old.operations.insert(
        format!("goal_rules:{}", accounts(2)),
        near_sdk::serde_json::to_vec(&rules).unwrap(),
    );
    old.operations
        .insert(format!("fund:{}:once", accounts(1)), env::sha256(b"studio"));
    old.operations.insert(
        format!("register:{}:register", accounts(1)),
        env::sha256(&near_sdk::serde_json::to_vec(&("studio", accounts(1))).unwrap()),
    );
    for (id, state, company, amount) in [
        ("paid", "SUCCEEDED", None, 700),
        ("failed", "FAILED", None, 800),
        ("employee-pending", "PENDING", None, 3000),
        (
            "company-pending",
            "PENDING",
            Some("studio".to_string()),
            2000,
        ),
    ] {
        old.withdrawals.insert(
            id.into(),
            Withdrawal {
                account_id: if company.is_some() {
                    accounts(1)
                } else {
                    accounts(2)
                },
                amount: U128(amount),
                state: state.into(),
                company_id: company,
            },
        );
    }
    for sequence in 1..=5 {
        old.events.push(Event {
            event_sequence: U64(sequence),
            event_type: "Historical".into(),
            reference: format!("old-{sequence}"),
            account_id: accounts(2),
            amount: U128(sequence as u128),
        });
        old.operations.insert(format!("event_v2:{sequence}"), near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"schemaVersion":2,"timestampNs":"100","snapshot":sequence})).unwrap());
    }
    old
}

#[test]
fn v3_migration_preserves_every_row_accounting_and_replay_defense() {
    context(accounts(0), 100);
    let old = legacy_fixture();
    let expected_events = near_sdk::serde_json::to_value(&old.events).unwrap();
    let expected_operations = old.operations.clone();
    let expected_business = borsh::to_vec(&(
        &old.executor,
        &old.companies,
        &old.employees,
        &old.obligations,
        &old.cash,
        &old.policies,
    ))
    .unwrap();
    let expected_withdrawals = borsh::to_vec(&old.withdrawals).unwrap();
    env::state_write(&old);
    let mut c = Contract::migrate_from_v2();
    assert_eq!(
        borsh::to_vec(&(
            &c.executor,
            &c.companies.iter().collect::<BTreeMap<_, _>>(),
            &c.employees.iter().collect::<BTreeMap<_, _>>(),
            &c.obligations.iter().collect::<BTreeMap<_, _>>(),
            &c.cash.iter().collect::<BTreeMap<_, _>>(),
            &c.policies.iter().collect::<BTreeMap<_, _>>()
        ))
        .unwrap(),
        expected_business
    );
    assert_eq!(
        near_sdk::serde_json::to_value(c.list_events(0, 100)).unwrap(),
        expected_events
    );
    for (key, value) in expected_operations {
        assert_eq!(c.operations.get(&key), Some(&value));
    }
    let actual: BTreeMap<_, _> = old
        .withdrawals
        .keys()
        .map(|id| (id.clone(), c.get_withdrawal(id.clone()).unwrap()))
        .collect();
    assert_eq!(borsh::to_vec(&actual).unwrap(), expected_withdrawals);
    assert_eq!(c.pending_withdrawals.len(), 2);
    assert_eq!(c.total_liability, old.total_liability);
    assert_eq!(c.pending_transfers, old.pending_transfers);
    assert_eq!(c.financial_summary()["version"], 2);
    assert_eq!(c.financial_summary()["storageVersion"], 3);
    assert_eq!(c.financial_summary()["liabilityValid"], true);
    persist(&mut c);
    context(accounts(1), 150);
    c.register_company("studio".into(), "register".into());
    let conflict = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.register_company("other".into(), "register".into())
    }));
    assert!(conflict.is_err());
    let funding = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.fund_treasury_once("studio".into(), "once".into())
    }));
    assert!(funding.is_err());
    context(accounts(2), 150);
    for id in ["paid", "failed", "employee-pending"] {
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                || c.request_withdrawal(U128(1), id.into())
            ))
            .is_err()
        );
    }
    result_context(near_sdk::PromiseResult::Successful(vec![]));
    assert!(c.on_withdraw_result("paid".into()));
    assert!(c.on_withdraw_result("employee-pending".into()));
    assert!(c.on_withdraw_result("employee-pending".into()));
    result_context(near_sdk::PromiseResult::Failed);
    assert!(!c.on_withdraw_result("failed".into()));
    assert!(!c.on_withdraw_result("company-pending".into()));
    assert!(!c.on_withdraw_result("company-pending".into()));
    assert_eq!(c.pending_transfers, 0);
    assert_eq!(c.total_liability, 17_000);
    assert_eq!(c.companies["studio"].free.0, 4000);
    assert_eq!(c.financial_summary()["liabilityValid"], true);
    assert_eq!(c.events.len(), 7);
    assert_eq!(c.list_events(5, 2)[0].event_sequence.0, 6);
    persist(&mut c);
    context(accounts(0), 400);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(Contract::migrate_from_v2)).is_err()
    );
}

#[test]
#[should_panic(expected = "PRIVATE_MIGRATION")]
fn v3_migration_rejects_non_self_caller() {
    context(accounts(1), 100);
    env::state_write(&legacy_fixture());
    Contract::migrate_from_v2();
}

#[test]
#[should_panic(expected = "PENDING_WITHDRAWAL_LIMIT")]
fn v3_pending_limit_applies_only_to_concurrent_requests() {
    let mut c = setup();
    for n in 0..MAX_PENDING_WITHDRAWALS {
        c.pending_withdrawals.insert(format!("pending-{n}"));
    }
    context(accounts(2), 200);
    let _ = c.request_withdrawal(U128(1), "over-pending-limit".into());
}

#[test]
fn v3_callback_keeps_its_reserved_slot_at_sdk_index_boundary() {
    let mut c = setup();
    authorize(&mut c);
    context(accounts(2), 201);
    c.claim_due("o1".into());
    drop(c.request_withdrawal(U128(1), "last-sdk-slot".into()));
    c.flush_history();
    // A sparse fixture exercises the real u32 boundary without writing
    // billions of records. SDK Vector serializes its length first.
    let mut bytes = borsh::to_vec(&c.events).unwrap();
    bytes[..4].copy_from_slice(&(u32::MAX - 1).to_le_bytes());
    c.events = Vector::try_from_slice(&bytes).unwrap();
    let blocked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.emit("Unrelated", "x", accounts(1), 0)
    }));
    assert!(blocked.is_err());
    result_context(near_sdk::PromiseResult::Successful(vec![]));
    assert!(c.on_withdraw_result("last-sdk-slot".into()));
    assert_eq!(c.events.len(), u32::MAX);
    assert_eq!(
        c.list_events(u32::MAX - 1, 100)[0].event_type,
        "WithdrawalResolved"
    );
    assert_eq!(
        c.get_event_details(u32::MAX - 1, 100)[0]["details"]["withdrawal"]["state"],
        "SUCCEEDED"
    );
    assert_eq!(c.pending_transfers, 0);
}
