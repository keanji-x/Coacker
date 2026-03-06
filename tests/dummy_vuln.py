# Account Balance Management
accounts = {
    "user_1": {"balance": 100},
    "user_2": {"balance": 50}
}

def transfer_funds(from_user, to_user, amount):
    """
    Transfers funds from one user to another.
    """
    if from_user not in accounts or to_user not in accounts:
        return "Invalid users"
        
    sender_balance = accounts[from_user]["balance"]
    
    if sender_balance < amount:
        return "Insufficient funds"
        
    # LOGIC BUG 1: Forgot to deduct from sender
    # accounts[from_user]["balance"] -= amount
    
    # LOGIC BUG 2: Potential datarares, missing locks for concurrent execution
    
    # STYLE BUG 1: Unused variable
    fee = amount * 0.01 
    
    accounts[to_user]["balance"] += amount
    
    # STYLE BUG 2: Bad naming / redundant print
    print("Trnsfr scssful")
    
    return "Success"

def trigger_transfer():
    # Simple test case invocation
    transfer_funds("user_1", "user_2", 30)

if __name__ == "__main__":
    trigger_transfer()
