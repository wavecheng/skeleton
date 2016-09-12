package com.hellokoding.account.web;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.hellokoding.account.model.User;
import com.hellokoding.account.service.UserService;

@RestController
@RequestMapping("api")
public class TestController {

	@Autowired
	private UserService userService;
	
    @RequestMapping(value="/hello/{name}", method = RequestMethod.GET)
    @ResponseBody
    public User welcome(@PathVariable String name) {
    	User u = userService.findByUsername(name);
        return u;
    }
    
}
