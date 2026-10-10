// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Test.sol";
import "../contracts/QogeStreak.sol";

/// @dev Minimal $QOGE stub so tests can flip the holder flag.
contract QOGEStub is IQOGE {
    mapping(address => uint256) public override balanceOf;

    function set(address a, uint256 v) external {
        balanceOf[a] = v;
    }
}

contract QogeStreakTest is Test {
    QOGEStub qoge;
    QogeStreak streak;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    // ship's-log day 1 = 2026-10-04 00:00 UTC (Unix day 20730, must match GENESIS_DAY)
    uint256 constant DAY1 = 20730 days;

    function setUp() public {
        qoge = new QOGEStub();
        streak = new QogeStreak(qoge);
    }

    function testDayOne() public {
        vm.warp(DAY1);
        assertEq(streak.currentDay(), 1);
        vm.warp(DAY1 + 3 days);
        assertEq(streak.currentDay(), 4);
    }

    function testBeforeGenesisReverts() public {
        vm.warp(DAY1 - 1);
        vm.expectRevert(QogeStreak.LogNotStarted.selector);
        streak.currentDay();
    }

    function testStreakAndBest() public {
        qoge.set(alice, 42 ether);
        vm.startPrank(alice);

        vm.warp(DAY1);
        streak.checkIn();
        (uint32 lastDay, uint32 s, uint32 best, uint64 checks, bool holder) = streak.streakOf(alice);
        assertEq(lastDay, 1); assertEq(s, 1); assertEq(best, 1); assertEq(checks, 1); assertTrue(holder);

        vm.warp(DAY1 + 1 days); // consecutive
        streak.checkIn();
        (, s, best, checks, holder) = streak.streakOf(alice);
        assertEq(s, 2); assertEq(best, 2); assertEq(checks, 2);

        vm.warp(DAY1 + 5 days); // gap: streak restarts
        streak.checkIn();
        (lastDay, s, best, checks, ) = streak.streakOf(alice);
        assertEq(lastDay, 6); assertEq(s, 1); assertEq(best, 2); assertEq(checks, 3);
        vm.stopPrank();
    }

    function testDoubleCheckInReverts() public {
        vm.warp(DAY1);
        vm.prank(bob);
        streak.checkIn();
        vm.warp(DAY1 + 12 hours); // same UTC day
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(QogeStreak.AlreadyCheckedIn.selector, 1));
        streak.checkIn();
    }

    function testNonHolderFlag() public {
        vm.warp(DAY1);
        vm.prank(bob);
        streak.checkIn();
        (,,,, bool holder) = streak.streakOf(bob);
        assertFalse(holder);
        assertEq(streak.crewSize(), 1);
    }

    function testCrewCountsUnique() public {
        vm.warp(DAY1);
        vm.prank(alice); streak.checkIn();
        vm.warp(DAY1 + 1 days);
        vm.prank(alice); streak.checkIn();
        vm.prank(bob); streak.checkIn();
        assertEq(streak.crewSize(), 2);
    }
}
