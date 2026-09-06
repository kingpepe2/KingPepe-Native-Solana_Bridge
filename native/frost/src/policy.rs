use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DomainBinding {
    pub native_chain_id: u32,
    pub solana_chain_id: u32,
    pub native_genesis: [u8; 32],
    pub solana_cluster: [u8; 32],
    pub manager_program_id: [u8; 32],
    pub transceiver_program_id: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct SigningPolicy {
    pub deployment_epoch: u32,
    pub max_fee: u64,
    pub max_amount: u64,
    pub expected_domains: DomainBinding,
}

pub fn policy_bound_domain_ok(
    policy: &SigningPolicy,
    binding: &DomainBinding,
    epoch: u64,
) -> Result<(), SigningPolicyError> {
    if policy.deployment_epoch as u64 != epoch {
        return Err(SigningPolicyError::EpochMismatch);
    }

    if policy.expected_domains.native_chain_id == 0 || policy.expected_domains.solana_chain_id == 0 {
        return Err(SigningPolicyError::DomainMismatch);
    }

    if policy.expected_domains.native_chain_id != binding.native_chain_id
        || policy.expected_domains.solana_chain_id != binding.solana_chain_id
        || policy.expected_domains.native_genesis != binding.native_genesis
        || policy.expected_domains.solana_cluster != binding.solana_cluster
        || policy.expected_domains.manager_program_id != binding.manager_program_id
        || policy.expected_domains.transceiver_program_id != binding.transceiver_program_id
    {
        return Err(SigningPolicyError::DomainMismatch);
    }

    Ok(())
}

pub fn validate_amount_fits_limits(policy: &SigningPolicy, amount: u64, fee: u64) -> Result<(), SigningPolicyError> {
    if amount == 0 {
        return Err(SigningPolicyError::ZeroAmount);
    }
    if fee > policy.max_fee {
        return Err(SigningPolicyError::FeeAboveLimit);
    }
    if amount > policy.max_amount {
        return Err(SigningPolicyError::AmountAboveLimit);
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum SigningPolicyError {
    #[error("requested fee above policy max")]
    FeeAboveLimit,
    #[error("requested amount above policy max")]
    AmountAboveLimit,
    #[error("amount must be non-zero")]
    ZeroAmount,
    #[error("domain binding is not recognized for this operation")]
    DomainMismatch,
    #[error("deployment epoch mismatch")]
    EpochMismatch,
    #[error("policy validation failed")]
    Rejected,
}
