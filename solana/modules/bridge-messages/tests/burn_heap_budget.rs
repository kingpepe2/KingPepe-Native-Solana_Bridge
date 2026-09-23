//! The SBF bump allocator does not reclaim temporary Vec allocations. Repeated
//! protocol validation must fit the normal 32 KiB heap without a larger frame.
use bridge_messages::CanonicalBridgeMessage;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

struct CountAllocations;
thread_local! {
    static ALLOCATED: Cell<Option<usize>> = const { Cell::new(None) };
}
unsafe impl GlobalAlloc for CountAllocations {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATED.with(|count| {
            if let Some(total) = count.get() {
                count.set(Some(total + layout.size()));
            }
        });
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        System.dealloc(pointer, layout);
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        ALLOCATED.with(|count| {
            if let Some(total) = count.get() {
                count.set(Some(total + size));
            }
        });
        System.realloc(pointer, layout, size)
    }
}
#[global_allocator]
static ALLOCATOR: CountAllocations = CountAllocations;

#[test]
fn repeated_full_burn_validation_leaves_room_for_accounts_and_cpi() {
    let vector: serde_json::Value =
        serde_json::from_str(include_str!("../vectors/burn-borsh-v4.json")).unwrap();
    let encoded = vector["messageHex"].as_str().unwrap();
    let bytes: Vec<u8> = encoded
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    ALLOCATED.with(|count| count.set(Some(0)));
    let message = CanonicalBridgeMessage::decode(&bytes).unwrap();
    // Covers repeated checks across instruction decoding, receipt comparison,
    // replay derivation and verification. No check is removed to save heap.
    for _ in 0..12 {
        message.validate().unwrap();
        message.derive_operation_id().unwrap();
        message.message_digest().unwrap();
    }
    let encoded_again = message.encode().unwrap();
    let total = ALLOCATED.with(|count| count.replace(None).unwrap());
    assert_eq!(encoded_again, bytes);
    assert!(total < 4096, "canonical burn heap allocation: {total}");
}
