fn constrained_callback_context(result: near_sdk::PromiseResult) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(accounts(0))
        .predecessor_account_id(accounts(0))
        .account_balance(NearToken::from_near(1000))
        .storage_usage(env::storage_usage())
        .prepaid_gas(Gas::from_tgas(20))
        .block_timestamp(500);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        std::collections::HashMap::default(),
        vec![result]
    );
}

#[test]
fn v3_callback_wrapper_fits_20_tgas_with_1500_policies_and_2000_pending() {
    let mut c = setup();
    authorize(&mut c);
    context(accounts(2), 201);
    c.claim_due("o1".into());
    persist(&mut c);
    let initial_size = borsh::to_vec(&c).unwrap().len();
    for n in 0..1500 {
        receipt_context(accounts(1), NearToken::from_near(1000).as_yoctonear());
        let account: AccountId = format!("person{n}.testnet").parse().unwrap();
        let goals = (0..10)
            .map(|i| Goal {
                id: format!("g{i}{}", "x".repeat(98)),
                target: U128(100),
                funded: U128(0),
                priority: i + 1,
                paused: false,
                completed: false,
                released: false,
            })
            .collect();
        c.policies.insert(
            account,
            GoalPolicy {
                goals,
                goal_bps: 5000,
                cash_floor: U128(0),
                version: 1,
            },
        );
        if n % 50 == 49 {
            persist(&mut c);
        }
    }
    for n in 0..1999 {
        receipt_context(accounts(1), NearToken::from_near(1000).as_yoctonear());
        let id = format!("other-pending-{n}");
        c.withdrawals.insert(
            id.clone(),
            Withdrawal {
                account_id: accounts(2),
                amount: U128(1),
                state: "PENDING".into(),
                company_id: None,
            },
        );
        c.pending_withdrawals.insert(id);
        c.pending_transfers += 1;
        c.withdrawal_count += 1;
        *c.cash.get_mut(&accounts(2)).unwrap() -= 1;
        if n % 50 == 49 {
            persist(&mut c);
        }
    }
    persist(&mut c);
    let full_size = borsh::to_vec(&c).unwrap().len();
    assert_eq!(full_size, initial_size);
    assert!(full_size < 1024);
    for success in [true, false] {
        receipt_context(accounts(2), NearToken::from_near(1000).as_yoctonear());
        let id = if success {
            "full-success"
        } else {
            "full-failure"
        };
        drop(c.request_withdrawal(U128(1), id.into()));
        persist(&mut c);
        assert_eq!(c.pending_withdrawals.len(), 2000);
        constrained_callback_context(if success {
            near_sdk::PromiseResult::Successful(vec![])
        } else {
            near_sdk::PromiseResult::Failed
        });
        {
            let mut loaded: Contract = env::state_read().unwrap();
            assert_eq!(loaded.on_withdraw_result(id.into()), success);
            env::state_write(&loaded);
        }
        let gas = env::used_gas().as_gas();
        println!(
            "callback outcome={success}; policies=1500; pending=2000; STATE={full_size} bytes; full-wrapper gas={gas}"
        );
        assert!(gas < Gas::from_tgas(20).as_gas());
        receipt_context(accounts(2), NearToken::from_near(1000).as_yoctonear());
        c = env::state_read().unwrap();
        assert_eq!(c.pending_withdrawals.len(), 1999);
        let liability = c.total_liability;
        constrained_callback_context(if success {
            near_sdk::PromiseResult::Successful(vec![])
        } else {
            near_sdk::PromiseResult::Failed
        });
        {
            let mut loaded: Contract = env::state_read().unwrap();
            assert_eq!(loaded.on_withdraw_result(id.into()), success);
            env::state_write(&loaded);
            assert_eq!(loaded.total_liability, liability);
        }
        receipt_context(accounts(2), NearToken::from_near(1000).as_yoctonear());
        c = env::state_read().unwrap();
    }
}

#[test]
fn v3_lazy_lists_preserve_v2_sorted_order_and_pagination() {
    let mut c = setup();
    for id in ["zebra", "alpha", "middle"] {
        c.companies.insert(
            id.into(),
            Company {
                owner: accounts(1),
                free: U128(0),
                reserved: U128(0),
                version: 1,
            },
        );
        c.employees.insert(
            format!("studio:{id}"),
            Employee {
                company_id: "studio".into(),
                employee_id: id.into(),
                account_id: accounts(2),
                accepted: true,
            },
        );
        c.obligations.insert(
            id.into(),
            Obligation {
                id: id.into(),
                company_id: "studio".into(),
                employee_id: "e1".into(),
                account_id: accounts(2),
                amount: U128(1),
                due_at: U64(0),
                execution_not_after: U64(1000),
                credited: false,
                paused: false,
                cancelled: false,
                version: 1,
            },
        );
    }
    persist(&mut c);
    assert_eq!(
        c.list_companies(accounts(1))
            .into_iter()
            .map(|(id, _)| id)
            .collect::<Vec<_>>(),
        vec!["alpha", "middle", "studio", "zebra"]
    );
    assert_eq!(
        c.list_employments(accounts(2))
            .into_iter()
            .map(|e| e.employee_id)
            .collect::<Vec<_>>(),
        vec!["alpha", "e1", "middle", "zebra"]
    );
    assert_eq!(
        c.list_company_employees("studio".into())
            .into_iter()
            .map(|e| e.employee_id)
            .collect::<Vec<_>>(),
        vec!["alpha", "e1", "middle", "zebra"]
    );
    assert_eq!(c.list_due(1, 1)[0].id, "middle");
    assert_eq!(c.list_obligations(accounts(2), 1, 1)[0].id, "middle");
}

// Optional private fixture, read at runtime: no chain state is compiled in or
// copied into distributable artifacts. Use the original recorded balance/usage.
#[test]
#[ignore = "set NUMA_V2_STATE and NUMA_V2_CONTEXT to a private V2 snapshot"]
fn v3_rehearse_private_snapshot_without_balance_changes() {
    let bytes =
        std::fs::read(std::env::var("NUMA_V2_STATE").expect("NUMA_V2_STATE required")).unwrap();
    let context: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(
        &std::fs::read(std::env::var("NUMA_V2_CONTEXT").expect("NUMA_V2_CONTEXT required"))
            .unwrap(),
    )
    .unwrap();
    let old = ContractV2::try_from_slice(&bytes).unwrap();
    let balance = context["accountState"]["amount"]
        .as_str()
        .unwrap()
        .parse::<u128>()
        .unwrap();
    let usage = context["accountState"]["storage_usage"].as_u64().unwrap();
    let mut b = VMContextBuilder::new();
    b.current_account_id(accounts(0))
        .predecessor_account_id(accounts(0))
        .account_balance(NearToken::from_yoctonear(balance))
        .storage_usage(usage)
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
    env::storage_write(b"STATE", &bytes);
    // Restore recorded usage after seeding the mock trie, avoiding double count.
    testing_env!(b.build());
    {
        let c = Contract::migrate_from_v2();
        env::state_write(&c);
    }
    let gas = env::used_gas().as_gas();
    let after_usage = env::storage_usage();
    let mut c: Contract = env::state_read().unwrap();
    assert_eq!(env::account_balance().as_yoctonear(), balance);
    assert_eq!(c.total_liability, old.total_liability);
    assert_eq!(c.pending_transfers, old.pending_transfers);
    assert_eq!(c.events.len() as usize, old.events.len());
    for (index, event) in old.events.iter().enumerate() {
        assert_eq!(
            borsh::to_vec(c.events.get(index as u32).unwrap()).unwrap(),
            borsh::to_vec(event).unwrap()
        );
    }
    for (key, value) in &old.operations {
        assert_eq!(c.operations.get(key), Some(value));
    }
    for (key, value) in &old.withdrawals {
        assert_eq!(
            borsh::to_vec(c.withdrawals.get(key).unwrap()).unwrap(),
            borsh::to_vec(value).unwrap()
        );
    }
    macro_rules! compare_map {
        ($field:ident) => {
            for (key, value) in &old.$field {
                assert_eq!(
                    borsh::to_vec(c.$field.get(key).unwrap()).unwrap(),
                    borsh::to_vec(value).unwrap()
                );
            }
            assert_eq!(c.$field.len() as usize, old.$field.len());
        };
    }
    compare_map!(companies);
    compare_map!(employees);
    compare_map!(obligations);
    compare_map!(cash);
    compare_map!(policies);
    let summary = c.financial_summary();
    assert_eq!(summary["liabilityValid"], true);
    assert_eq!(summary["backingValid"], true);
    c.flush_history();
    println!(
        "Private snapshot rehearsal: events={}; policies={}; main STATE={} bytes; migration+state-write gas={gas}; original storage={usage}; migrated storage={after_usage}; original balance preserved=true",
        c.events.len(),
        c.policies.len(),
        borsh::to_vec(&c).unwrap().len()
    );
}
