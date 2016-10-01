package com.hellokoding.account.bmpnlistener;

import org.activiti.engine.IdentityService;
import org.springframework.beans.factory.annotation.Autowired;

public class EmailFinder {

	@Autowired
	private IdentityService identityService;
	
	public String getEmailAddress(String userId){
		System.out.println("lookup user email address:" + userId + "==> " + identityService.getUserInfo(userId, "email"));
		return "449072269@qq.com";
	}
	
}
