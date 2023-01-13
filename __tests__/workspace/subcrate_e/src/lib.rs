pub use fuel_dummy_test_subcrate_d::TEST_VALUE as OTHER_TEST_VALUE;

#[cfg(test)]
mod tests {
    pub use fuel_dummy_test_subcrate_f::TEST_VALUE;
    #[test]
    fn it_works() {
        let result = 2 + 2;
        assert_eq!(result, 4);
    }
}
