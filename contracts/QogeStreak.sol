// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title QogeStreak — on-chain visit streak for qoge.fun
/// @notice One `checkIn()` per UTC day. The site's "ship's log" day counter
///         starts at 2026-10-04 UTC (GENESIS_DAY), so `currentDay()` matches
///         the day number shown on the page. Streak, best streak, total
///         check-ins and a $QOGE holder flag are public and emitted in
///         events — the whole crew's streak is verifiable on-chain.
/// @dev No owner, no upgrade, no token transfers: the contract only records
///      check-ins. Holder check is a passive balanceOf view call on $QOGE.
interface IQOGE {
    function balanceOf(address account) external view returns (uint256);
}

contract QogeStreak {
    /// @notice Unix day (timestamp / 86400) of 2026-10-04 UTC — ship's log day 1.
    uint256 public constant GENESIS_DAY = 20730;

    IQOGE public immutable qoge;

    struct Entry {
        uint32 lastDay; // 1-based ship's-log day of the last check-in
        uint32 streak;  // consecutive days ending at lastDay
        uint32 best;    // all-time best streak
        uint64 checks;  // total check-ins
        bool holder;    // held $QOGE (>0) at the last check-in
    }

    mapping(address => Entry) public entries;
    address[] private crew;
    mapping(address => bool) private inCrew;

    event CheckIn(address indexed sailor, uint32 day, uint32 streak, uint32 best, uint64 checks, bool holder);

    error AlreadyCheckedIn(uint32 day);
    error LogNotStarted();

    constructor(IQOGE qoge_) {
        qoge = qoge_;
    }

    function currentDay() public view returns (uint32) {
        uint256 d = block.timestamp / 1 days;
        if (d < GENESIS_DAY) revert LogNotStarted();
        return uint32(d - GENESIS_DAY + 1);
    }

    /// @notice Record today's visit. Reverts if already checked in today.
    function checkIn() external {
        uint32 day = currentDay();
        Entry storage e = entries[msg.sender];
        if (e.lastDay == day) revert AlreadyCheckedIn(day);
        unchecked {
            e.streak = e.lastDay + 1 == day ? e.streak + 1 : 1;
            e.checks += 1;
        }
        e.lastDay = day;
        if (e.streak > e.best) e.best = e.streak;
        e.holder = qoge.balanceOf(msg.sender) > 0;
        if (!inCrew[msg.sender]) {
            inCrew[msg.sender] = true;
            crew.push(msg.sender);
        }
        emit CheckIn(msg.sender, day, e.streak, e.best, e.checks, e.holder);
    }

    /// @notice Everything the site needs for the on-chain streak card (eth_call).
    function streakOf(address a)
        external
        view
        returns (uint32 lastDay, uint32 streak, uint32 best, uint64 checks, bool holder)
    {
        Entry storage e = entries[a];
        return (e.lastDay, e.streak, e.best, e.checks, e.holder);
    }

    /// @notice How many addresses have ever checked in.
    function crewSize() external view returns (uint256) {
        return crew.length;
    }
}
