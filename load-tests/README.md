# Load tests

`capacity_test.js` is a [k6](https://k6.io/) script implementing the baseline and ramp
scenarios from [`docs/CAPACITY_TEST_PLAN.md`](../docs/CAPACITY_TEST_PLAN.md). It has never been
run — see that plan's "Safe execution procedure" (§7) before running it against anything,
including staging. It refuses to run against the known production API host, but that is a floor,
not a substitute for reading the plan.

k6 itself is not a dependency of this repository; install it separately from the link above.
